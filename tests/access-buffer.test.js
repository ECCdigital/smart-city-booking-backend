const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Booking } = require("../src/commons/entities/booking/booking");

const MINUTE = 60 * 1000;

function createBooking(overrides = {}) {
  return new Booking({
    id: "booking-1",
    tenantId: "tenant-1",
    mail: "owner@example.com",
    isCommitted: true,
    isPayed: true,
    priceEur: 0,
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [{ bookableId: "room" }],
    // The booker of every booking here: the access decision reads the
    // booking's owner key, it asks nobody (authorize spec §4.1, §5).
    assignedUserId: "user-1",
    ...overrides,
  });
}

describe("Booking access window", () => {
  it("is valid when committed and not rejected (free booking)", () => {
    const booking = createBooking({ priceEur: 0, isPayed: false });
    expect(booking.isBookingValid()).to.be.true;
  });

  it("requires payment when priced", () => {
    const booking = createBooking({ priceEur: 10, isPayed: false });
    expect(booking.isBookingValid()).to.be.false;
  });

  it("allows access within the lead time before timeBegin", () => {
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    const now = 90 * MINUTE; // 10 minutes before start
    expect(booking.isWithinAccessWindow(15 * MINUTE, 0, now)).to.be.true;
    expect(booking.isWithinAccessWindow(0, 0, now)).to.be.false;
  });

  it("allows access within the lag time after timeEnd", () => {
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    const now = 210 * MINUTE; // 10 minutes after end
    expect(booking.isWithinAccessWindow(0, 15 * MINUTE, now)).to.be.true;
    expect(booking.isWithinAccessWindow(0, 0, now)).to.be.false;
  });

  it("denies access outside of the buffered window", () => {
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    const now = 80 * MINUTE; // 20 minutes before start, buffer only 15
    expect(booking.isWithinAccessWindow(15 * MINUTE, 15 * MINUTE, now)).to.be
      .false;
  });

  it("denies access for an invalid booking even within the window", () => {
    const booking = createBooking({ isRejected: true });
    const now = booking.timeBegin;
    expect(booking.isWithinAccessWindow(60 * MINUTE, 60 * MINUTE, now)).to.be
      .false;
  });
});

describe("AccessService._resolveAccessBuffer", () => {
  it("falls back to no buffer", () => {
    const bookable = { accessPointDetails: {} };
    expect(AccessService._resolveAccessBuffer(bookable)).to.deep.equal({
      beforeMs: 0,
      afterMs: 0,
    });
  });

  it("uses the buffer configured on the bookable", () => {
    const bookable = {
      accessPointDetails: { accessBuffer: { before: 10, after: 5 } },
    };
    expect(AccessService._resolveAccessBuffer(bookable)).to.deep.equal({
      beforeMs: 10 * MINUTE,
      afterMs: 5 * MINUTE,
    });
  });

  it("applies the same buffer to every access point of the bookable", () => {
    const bookable = {
      accessPointDetails: {
        accessBuffer: { before: 10, after: 5 },
        accessPointIds: ["door-1", "door-2"],
      },
    };
    expect(AccessService._resolveAccessBuffer(bookable)).to.deep.equal({
      beforeMs: 10 * MINUTE,
      afterMs: 5 * MINUTE,
    });
  });
});

describe("AccessService.canOperate with buffer", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function stubDoor(booking, accessBuffer) {
    sandbox.stub(AccessService, "_getBookingAccessPointsFromBooking").resolves({
      booking,
      compartments: [],
      doors: [
        {
          accessPoint: { id: "door-1", tenant: "tenant-1", type: "door" },
          bookingContext: { accessBuffer },
        },
      ],
    });
  }

  /**
   * A granted compartment of an iFBS location as the resolver hands it
   * over, with the buffer of its bookable.
   */
  function stubCompartment(booking, accessBuffer) {
    sandbox.stub(AccessService, "_getBookingAccessPointsFromBooking").resolves({
      booking,
      doors: [],
      compartments: [
        {
          accessPoint: {
            id: "loc-1:ifbs-booking-99",
            tenantId: "tenant-1",
            type: "locker",
            provider: "ifbs",
            mode: "remote",
            validationRules: [],
          },
          bookingContext: {
            accessBuffer,
            isProvisioned: true,
            grant: { authorizationId: "ifbs-booking-99" },
            revokedAt: null,
          },
        },
      ],
    });
  }

  it("allows the owner to operate within the lead time buffer", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubDoor(booking, { beforeMs: 15 * MINUTE, afterMs: 0 });

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("denies operation before the lead time buffer starts", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 30 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubDoor(booking, { beforeMs: 15 * MINUTE, afterMs: 0 });

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.false;
  });

  it("returns false when the booking does not exist", async () => {
    sandbox.stub(BookingManager, "getBooking").resolves(null);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "missing",
      "door-1",
      true,
    );
    expect(allowed).to.be.false;
  });

  it("allows the owner to operate a compartment within the buffered window of its bookable", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubCompartment(booking, { beforeMs: 15 * MINUTE, afterMs: 0 });

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "loc-1:ifbs-booking-99",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("denies operating a compartment outside the booking window", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 30 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubCompartment(booking, { beforeMs: 0, afterMs: 0 });

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "loc-1:ifbs-booking-99",
      false,
    );
    expect(allowed).to.be.false;
  });
});

describe("AccessService.canView", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("lists access points for a valid booking outside its time window", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 24 * 60 * MINUTE,
      timeEnd: now + 25 * 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);

    const allowed = await AccessService.canView(
      "user-1",
      "tenant-1",
      "booking-1",
      true,
    );
    expect(allowed).to.be.true;
  });

  it("denies viewing for an invalid (uncommitted) booking", async () => {
    const booking = createBooking({ isCommitted: false });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);

    const allowed = await AccessService.canView(
      "user-1",
      "tenant-1",
      "booking-1",
      true,
    );
    expect(allowed).to.be.false;
  });

  it("lets the booker view their own booking without the manage permission", async () => {
    const booking = createBooking({ assignedUserId: "user-1" });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);

    const allowed = await AccessService.canView(
      "user-1",
      "tenant-1",
      "booking-1",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("denies viewing somebody else's booking without the manage permission", async () => {
    const booking = createBooking({ assignedUserId: "other-user" });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);

    const allowed = await AccessService.canView(
      "user-1",
      "tenant-1",
      "booking-1",
      false,
    );
    expect(allowed).to.be.false;
  });

  it("denies viewing a booking that does not exist", async () => {
    sandbox.stub(BookingManager, "getBooking").resolves(null);

    const allowed = await AccessService.canView(
      "user-1",
      "tenant-1",
      "booking-1",
      true,
    );
    expect(allowed).to.be.false;
  });
});
