const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");

const MINUTE = 60 * 1000;

function createBooking(overrides = {}) {
  return new Booking({
    id: "booking-1",
    tenantId: "tenant-1",
    assignedUserId: "user-1",
    mail: "owner@example.com",
    isCommitted: true,
    isPayed: true,
    priceEur: 0,
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [{ bookableId: "room" }],
    ...overrides,
  });
}

/**
 * A door as the booking way resolves it internally: the access point itself
 * plus the booking context it was resolved with.
 */
function createDoorEntry({ accessBuffer, bookingContext, ...overrides } = {}) {
  return {
    accessPoint: {
      id: "door-1",
      type: "door",
      provider: "nuki",
      mode: AccessPointMode.REMOTE,
      ...overrides,
    },
    bookingContext: {
      accessBuffer: accessBuffer || { beforeMs: 0, afterMs: 0 },
      isProvisioned: true,
      ...bookingContext,
    },
  };
}

/**
 * The doors of a booking as the resolver hands them to the decision, and no
 * compartments.
 */
function stubResolvedDoors(sandbox, booking, doors) {
  sandbox
    .stub(AccessService, "_getBookingAccessPointsFromBooking")
    .resolves({ booking, doors, compartments: [] });
}

describe("AccessService.canOperate", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("delegates to eligibility for a resolved door", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubResolvedDoors(sandbox, booking, [
      {
        accessPoint: {
          id: "door-1",
          tenant: "tenant-1",
          type: "door",
          mode: AccessPointMode.REMOTE,
        },
        bookingContext: {
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
        },
      },
    ]);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("lets a door that only takes a code be closed and asked for its status once it is granted", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubResolvedDoors(sandbox, booking, [
      createDoorEntry({
        mode: AccessPointMode.AUTHORIZATION,
        bookingContext: { grant: { authorizationId: "auth-1" } },
      }),
    ]);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("refuses a door that only takes a code while its grant is missing", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubResolvedDoors(sandbox, booking, [
      createDoorEntry({
        mode: AccessPointMode.AUTHORIZATION,
        bookingContext: { isProvisioned: false },
      }),
    ]);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.false;
  });

  it("returns false when the access point is not part of the booking", async () => {
    const booking = createBooking();
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    stubResolvedDoors(sandbox, booking, []);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "missing-door",
      true,
    );
    expect(allowed).to.be.false;
  });
});

describe("AccessService.getUserBookingsWithAccess includeEligibility", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("attaches accessEligibility when requested", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          [
            "tenant-1",
            new Map([
              ["room", new Map([["door-1", { mode: "remote", type: "door" }]])],
            ]),
          ],
        ]),
      );
    sandbox
      .stub(AccessService, "_getFilteredBookingAccessPointEntries")
      .resolves([createDoorEntry()]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      // The caller's answer, not the service's question (spec §5): this
      // one manages the bookings of no tenant.
      canManageIn: async () => false,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].accessEligibility).to.include({
      canOperate: true,
      canOperateRemote: true,
    });
    expect(results[0].accessEligibility.operableAccessPointIds).to.deep.equal([
      "door-1",
    ]);
  });

  it("honors access buffers for active filtering when includeEligibility is set", async () => {
    const now = 90 * MINUTE;
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          [
            "tenant-1",
            new Map([
              ["room", new Map([["door-1", { mode: "remote", type: "door" }]])],
            ]),
          ],
        ]),
      );
    sandbox
      .stub(AccessService, "_getFilteredBookingAccessPointEntries")
      .resolves([
        createDoorEntry({
          accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
        }),
      ]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      // The caller's answer, not the service's question (spec §5): this
      // one manages the bookings of no tenant.
      canManageIn: async () => false,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].accessEligibility.canOperate).to.be.true;
    expect(results[0].accessEligibility.blockingReasons).to.not.include(
      ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
    );
  });

  it("includes uncommitted bookings when includeEligibility is set", async () => {
    const now = 90 * MINUTE;
    const booking = createBooking({
      isCommitted: false,
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          [
            "tenant-1",
            new Map([
              ["room", new Map([["door-1", { mode: "remote", type: "door" }]])],
            ]),
          ],
        ]),
      );
    sandbox
      .stub(AccessService, "_getFilteredBookingAccessPointEntries")
      .resolves([
        createDoorEntry({
          accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
        }),
      ]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      // The caller's answer, not the service's question (spec §5): this
      // one manages the bookings of no tenant.
      canManageIn: async () => false,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].isCommitted).to.be.false;
    expect(results[0].accessEligibility.canOperate).to.be.false;
    expect(results[0].accessEligibility.primaryBlockingReason).to.equal(
      ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
    );
  });
});

describe("AccessService.getUserBookingsWithAccess includeAccessPoints", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * List the bookings of a user who may manage the bookings of the tenant,
   * with one door that demands a QR scan. The booking belongs to `booker-1`.
   */
  async function listFor(userId) {
    const now = Date.now();
    const booking = createBooking({
      assignedUserId: "booker-1",
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          [
            "tenant-1",
            new Map([
              ["room", new Map([["door-1", { mode: "remote", type: "door" }]])],
            ]),
          ],
        ]),
      );
    sandbox
      .stub(AccessService, "_getFilteredBookingAccessPointEntries")
      .resolves([createDoorEntry({ validationRules: [{ type: "qrScan" }] })]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    return AccessService.getUserBookingsWithAccess(userId, {
      state: "active",
      includeAccessPoints: true,
      // Whoever is listed here manages the bookings of the tenant.
      canManageIn: async () => true,
      now,
    });
  }

  it("demands the evidence of the door from the booker of the booking", async () => {
    const results = await listFor("booker-1");

    expect(results[0].accessPoints[0].validationRuleTypes).to.deep.equal([
      "qrScan",
    ]);
  });

  it("demands no evidence where the booking belongs to somebody else", async () => {
    const results = await listFor("manager-9");

    expect(results[0].accessPoints[0].validationRuleTypes).to.deep.equal([]);
  });
});
