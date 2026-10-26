/**
 * Reinstating warns of a double booking: what `findReinstatementConflicts`
 * finds over in-memory bookables and bookings, and how
 * `POST /api/:tenant/bookings/:id/reinstate` answers it - 409
 * `booking_reinstatement_conflict` with the conflicts, or the reinstatement
 * when there are none or the body says `ignoreConflicts: true`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  findReinstatementConflicts,
} = require("../src/commons/availability/reinstatement-conflicts");
const {
  CheckoutDataProvider,
  InMemoryAvailabilityDataProvider,
} = require("../src/commons/availability/providers");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  bookingLifecycle,
} = require("../src/commons/services/booking-lifecycle");

const TENANT = "tenant-1";
const TIME_BEGIN = Date.now() + 24 * 60 * 60 * 1000;
const TIME_END = TIME_BEGIN + 2 * 60 * 60 * 1000;

function booking(id, overrides = {}) {
  return {
    id,
    tenantId: TENANT,
    isRejected: false,
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
    bookableItems: [{ bookableId: "room-a", amount: 1 }],
    ...overrides,
  };
}

function room(overrides = {}) {
  return {
    id: "room-a",
    tenantId: TENANT,
    title: "Raum A",
    type: "room",
    isBookable: true,
    isScheduleRelated: true,
    amount: 1,
    ...overrides,
  };
}

/** A provider factory over one bookable and its bookings by bookable. */
function providerOf({
  bookable = room(),
  parentBookables = [],
  relatedBookables = [],
  bookingsByBookableId = {},
} = {}) {
  return async () =>
    new InMemoryAvailabilityDataProvider({
      tenantId: TENANT,
      bookable,
      parentBookables,
      relatedBookables,
      bookingsByBookableId,
    });
}

const CANCELLED = booking("B-OLD", { isRejected: true, status: "cancelled" });

describe("findReinstatementConflicts", function () {
  it("names the position and the booking that took its period", async function () {
    const conflicts = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({
        bookingsByBookableId: {
          "room-a": [CANCELLED, booking("B-NEW")],
        },
      }),
    });

    expect(conflicts).to.deep.equal([
      {
        bookableId: "room-a",
        title: "Raum A",
        bookings: [{ id: "B-NEW", timeBegin: TIME_BEGIN, timeEnd: TIME_END }],
      },
    ]);
  });

  it("finds none where the period is free or the capacity has room", async function () {
    const free = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({
        bookingsByBookableId: {
          "room-a": [
            CANCELLED,
            booking("B-LATER", {
              timeBegin: TIME_END + 1000,
              timeEnd: TIME_END + 2000,
            }),
          ],
        },
      }),
    });
    const room2 = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({
        bookable: room({ amount: 2 }),
        bookingsByBookableId: { "room-a": [CANCELLED, booking("B-NEW")] },
      }),
    });

    expect(free).to.deep.equal([]);
    expect(room2).to.deep.equal([]);
  });

  it("ignores other cancelled or rejected bookings", async function () {
    const conflicts = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({
        bookingsByBookableId: {
          "room-a": [CANCELLED, booking("B-GONE", { isRejected: true })],
        },
      }),
    });

    expect(conflicts).to.deep.equal([]);
  });

  it("names the bookings of a parent without room under the position", async function () {
    const building = room({ id: "building", title: "Haus", amount: 1 });
    const conflicts = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({
        bookable: room({ amount: 5 }),
        parentBookables: [building],
        bookingsByBookableId: {
          "room-a": [CANCELLED],
          building: [
            booking("B-HOUSE", {
              bookableItems: [{ bookableId: "building", amount: 1 }],
            }),
          ],
        },
      }),
    });

    expect(conflicts).to.have.length(1);
    expect(conflicts[0].title).to.equal("Raum A");
    expect(conflicts[0].bookings.map((b) => b.id)).to.deep.equal(["B-HOUSE"]);
  });

  it("skips a bookable that no longer exists", async function () {
    const conflicts = await findReinstatementConflicts(CANCELLED, {
      createProvider: providerOf({ bookable: null }),
    });

    expect(conflicts).to.deep.equal([]);
  });
});

function response() {
  return {
    status: sinon.stub().returnsThis(),
    send: sinon.stub().returnsThis(),
    json: sinon.stub().returnsThis(),
  };
}

function request(body = {}) {
  return {
    params: { tenant: TENANT, id: "B-OLD" },
    user: { id: "admin" },
    reach: "any",
    body,
  };
}

describe("BookingController.reinstateBooking: the conflict", function () {
  let sandbox;
  let reinstate;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    sandbox.stub(BookingManager, "getBooking").resolves(CANCELLED);
    sandbox.stub(CheckoutDataProvider, "create").callsFake(
      providerOf({
        bookingsByBookableId: { "room-a": [CANCELLED, booking("B-NEW")] },
      }),
    );
    reinstate = sandbox.stub(bookingLifecycle, "reinstate").resolves({});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("answers 409 booking_reinstatement_conflict and does not reinstate", async function () {
    const res = response();

    await BookingController.reinstateBooking(request(), res);

    expect(res.status.firstCall.args[0]).to.equal(409);
    const body = res.json.firstCall.args[0];
    expect(body.code).to.equal("booking_reinstatement_conflict");
    expect(body.params.bookingId).to.equal("B-OLD");
    expect(body.params.conflicts[0].bookings[0].id).to.equal("B-NEW");
    expect(reinstate.called).to.equal(false);
  });

  it("reinstates anyway with ignoreConflicts", async function () {
    const res = response();

    await BookingController.reinstateBooking(
      request({ ignoreConflicts: true }),
      res,
    );

    expect(reinstate.calledOnce).to.equal(true);
    expect(res.status.firstCall.args[0]).to.equal(200);
    expect(BookingManager.getBooking.called).to.equal(false);
  });

  it("reinstates when the period is free", async function () {
    CheckoutDataProvider.create.callsFake(
      providerOf({ bookingsByBookableId: { "room-a": [CANCELLED] } }),
    );
    const res = response();

    await BookingController.reinstateBooking(request(), res);

    expect(reinstate.calledOnce).to.equal(true);
    expect(res.status.firstCall.args[0]).to.equal(200);
  });
});
