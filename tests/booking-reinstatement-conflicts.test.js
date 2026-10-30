/**
 * Reinstating warns of a double booking: what `findReinstatementConflicts`
 * finds over in-memory bookables and bookings, and how
 * `POST /api/:tenant/bookings/:id/reinstate` answers it - 409
 * `booking_reinstatement_conflict` with the conflicts, or the reinstatement
 * when there are none or the body says `ignoreConflicts: true`; and how
 * `POST /api/:tenant/group-bookings/:id/reinstate` answers it per member,
 * `skipConflicts: true` reinstating the members without a conflict.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  findReinstatementConflicts,
} = require("../src/commons/services/checkout/reinstatement-conflicts");
const {
  CheckoutDataProvider,
  InMemoryAvailabilityDataProvider,
} = require("../src/commons/availability/providers");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  bookingLifecycle,
  groupBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle");
const {
  GroupBookingController,
} = require("../src/platform/api/controllers/group-booking-controller");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");

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

/** The in-memory data of the checkout: one bookable, its family and the bookings by bookable. */
function memoryOf({
  bookable = room(),
  parentBookables = [],
  relatedBookables = [],
  relatedBookablesByParentId = {},
  bookingsByBookableId = {},
} = {}) {
  return new InMemoryAvailabilityDataProvider({
    tenantId: TENANT,
    bookable,
    parentBookables,
    relatedBookables,
    relatedBookablesByParentId,
    bookingsByBookableId,
  });
}

/**
 * Serves the checkout a reinstatement runs per position: the bookable as
 * `BookableManager.getBookable` answers it (none for `bookable: null`), the
 * counts over the in-memory data.
 */
function given(sandbox, data = {}) {
  const bookable = data.bookable === undefined ? room() : data.bookable;
  sandbox
    .stub(BookableManager, "getBookable")
    .resolves(bookable ? new Bookable(bookable) : null);
  sandbox
    .stub(CheckoutDataProvider, "fromCheckoutService")
    .resolves(memoryOf({ ...data, bookable }));
}

const CANCELLED = booking("B-OLD", { isRejected: true, status: "cancelled" });

describe("findReinstatementConflicts", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  function conflictsOf(booking, data) {
    // A spec may ask twice; each answer is over its own data.
    sandbox.restore();
    given(sandbox, data);
    return findReinstatementConflicts(booking);
  }

  it("names the position and the booking that took its period", async function () {
    const conflicts = await conflictsOf(CANCELLED, {
      bookingsByBookableId: {
        "room-a": [CANCELLED, booking("B-NEW")],
      },
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
    const free = await conflictsOf(CANCELLED, {
      bookingsByBookableId: {
        "room-a": [
          CANCELLED,
          booking("B-LATER", {
            timeBegin: TIME_END + 1000,
            timeEnd: TIME_END + 2000,
          }),
        ],
      },
    });
    const room2 = await conflictsOf(CANCELLED, {
      bookable: room({ amount: 2 }),
      bookingsByBookableId: { "room-a": [CANCELLED, booking("B-NEW")] },
    });

    expect(free).to.deep.equal([]);
    expect(room2).to.deep.equal([]);
  });

  it("ignores other cancelled or rejected bookings", async function () {
    const conflicts = await conflictsOf(CANCELLED, {
      bookingsByBookableId: {
        "room-a": [CANCELLED, booking("B-GONE", { isRejected: true })],
      },
    });

    expect(conflicts).to.deep.equal([]);
  });

  it("names the bookings of a parent without room under the position", async function () {
    const building = room({ id: "building", title: "Haus", amount: 1 });
    const conflicts = await conflictsOf(CANCELLED, {
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
    });

    expect(conflicts).to.have.length(1);
    expect(conflicts[0].title).to.equal("Raum A");
    expect(conflicts[0].bookings).to.deep.equal([
      {
        id: "B-HOUSE",
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        parent: { bookableId: "building", title: "Haus" },
      },
    ]);
  });

  it("names the booking of another ticket that took the parent", async function () {
    const forum = room({
      id: "forum",
      title: "Forum",
      isScheduleRelated: false,
    });
    const quarter = room({
      id: "forum-quarter",
      title: "Forum 1/4 Tag",
      type: "ticket",
    });
    const day = room({ id: "forum-day", title: "Forum 1 Tag", type: "ticket" });
    const old = booking("B-OLD", {
      isRejected: true,
      status: "cancelled",
      bookableItems: [{ bookableId: "forum-quarter", amount: 1 }],
    });

    const conflicts = await conflictsOf(old, {
      bookable: quarter,
      parentBookables: [forum],
      relatedBookablesByParentId: { forum: [quarter, day] },
      bookingsByBookableId: {
        "forum-quarter": [old],
        "forum-day": [
          booking("B-DAY", {
            bookableItems: [{ bookableId: "forum-day", amount: 1 }],
          }),
        ],
      },
    });

    expect(conflicts).to.deep.equal([
      {
        bookableId: "forum-quarter",
        title: "Forum 1/4 Tag",
        bookings: [
          {
            id: "B-DAY",
            timeBegin: TIME_BEGIN,
            timeEnd: TIME_END,
            parent: { bookableId: "forum", title: "Forum" },
          },
        ],
      },
    ]);
  });

  it("names a dependent without room left under the parent", async function () {
    const workshop = room({ id: "workshop", title: "Werkstatt", amount: 1 });
    const table = room({ id: "table", title: "Tisch", amount: 1 });
    const old = booking("B-OLD", {
      isRejected: true,
      status: "cancelled",
      bookableItems: [{ bookableId: "workshop", amount: 1 }],
    });

    const conflicts = await conflictsOf(old, {
      bookable: workshop,
      relatedBookables: [table],
      bookingsByBookableId: {
        workshop: [old],
        table: [
          booking("B-TABLE", {
            bookableItems: [{ bookableId: "table", amount: 1 }],
          }),
        ],
      },
    });

    expect(conflicts).to.deep.equal([
      {
        bookableId: "workshop",
        title: "Werkstatt",
        bookings: [
          {
            id: "B-TABLE",
            timeBegin: TIME_BEGIN,
            timeEnd: TIME_END,
            child: { bookableId: "table", title: "Tisch" },
          },
        ],
      },
    ]);
  });

  it("finds none where a dependent still has room", async function () {
    const workshop = room({ id: "workshop", title: "Werkstatt", amount: 1 });
    const tools = room({ id: "tools", title: "Werkzeug", amount: 5 });
    const old = booking("B-OLD", {
      isRejected: true,
      status: "cancelled",
      bookableItems: [{ bookableId: "workshop", amount: 1 }],
    });

    const conflicts = await conflictsOf(old, {
      bookable: workshop,
      relatedBookables: [tools],
      bookingsByBookableId: {
        workshop: [old],
        tools: [
          booking("B-TOOLS", {
            bookableItems: [{ bookableId: "tools", amount: 1 }],
          }),
        ],
      },
    });

    expect(conflicts).to.deep.equal([]);
  });

  it("skips a bookable that no longer exists", async function () {
    const conflicts = await conflictsOf(CANCELLED, { bookable: null });

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
    given(sandbox, {
      bookingsByBookableId: { "room-a": [CANCELLED, booking("B-NEW")] },
    });
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
    CheckoutDataProvider.fromCheckoutService.resolves(
      memoryOf({ bookingsByBookableId: { "room-a": [CANCELLED] } }),
    );
    const res = response();

    await BookingController.reinstateBooking(request(), res);

    expect(reinstate.calledOnce).to.equal(true);
    expect(res.status.firstCall.args[0]).to.equal(200);
  });
});

describe("GroupBookingController.reinstateGroupBooking: the conflicts per member", function () {
  const DAY = 24 * 60 * 60 * 1000;
  // B-OLD's period is taken by B-NEW, B-FREE's a week later is not; B-KEPT
  // two weeks later is confirmed and no candidate.
  const FREE = booking("B-FREE", {
    isRejected: true,
    status: "cancelled",
    timeBegin: TIME_BEGIN + 7 * DAY,
    timeEnd: TIME_END + 7 * DAY,
  });
  const KEPT = booking("B-KEPT", {
    status: "confirmed",
    timeBegin: TIME_BEGIN + 14 * DAY,
    timeEnd: TIME_END + 14 * DAY,
  });

  let sandbox;
  let reinstate;

  function groupRequest(body = {}) {
    return { ...request(body), params: { tenant: TENANT, id: "G-1" } };
  }

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    sandbox.stub(GroupBookingManager, "getGroupBooking").resolves({
      id: "G-1",
      bookingIds: ["B-OLD", "B-FREE", "B-KEPT"],
      bookings: [CANCELLED, FREE, KEPT],
    });
    given(sandbox, {
      bookingsByBookableId: {
        "room-a": [CANCELLED, FREE, KEPT, booking("B-NEW")],
      },
    });
    reinstate = sandbox.stub(groupBookingLifecycle, "reinstate").resolves({});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("answers 409 group_booking_reinstatement_conflict naming the member in conflict, and reinstates nothing", async function () {
    const res = response();

    await GroupBookingController.reinstateGroupBooking(groupRequest(), res);

    expect(res.status.firstCall.args[0]).to.equal(409);
    const body = res.json.firstCall.args[0];
    expect(body.code).to.equal("group_booking_reinstatement_conflict");
    expect(body.params.groupBookingId).to.equal("G-1");
    expect(body.params.conflicts.map((c) => c.bookingId)).to.deep.equal([
      "B-OLD",
    ]);
    expect(body.params.conflicts[0].conflicts[0].bookings[0].id).to.equal(
      "B-NEW",
    );
    expect(reinstate.called).to.equal(false);
  });

  it("reinstates every cancelled member with ignoreConflicts", async function () {
    const res = response();

    await GroupBookingController.reinstateGroupBooking(
      groupRequest({ ignoreConflicts: true }),
      res,
    );

    expect(reinstate.calledOnce).to.equal(true);
    expect(reinstate.firstCall.args[2].bookingIds).to.equal(undefined);
    expect(res.status.lastCall.args[0]).to.equal(200);
  });

  it("reinstates only the members without a conflict with skipConflicts", async function () {
    const res = response();

    await GroupBookingController.reinstateGroupBooking(
      groupRequest({ skipConflicts: true }),
      res,
    );

    expect(reinstate.calledOnce).to.equal(true);
    expect(reinstate.firstCall.args[2].bookingIds).to.deep.equal(["B-FREE"]);
    expect(res.status.lastCall.args[0]).to.equal(200);
  });

  it("answers the conflict with skipConflicts where no member is free", async function () {
    GroupBookingManager.getGroupBooking.resolves({
      id: "G-1",
      bookingIds: ["B-OLD", "B-KEPT"],
      bookings: [CANCELLED, KEPT],
    });
    const res = response();

    await GroupBookingController.reinstateGroupBooking(
      groupRequest({ skipConflicts: true }),
      res,
    );

    expect(res.status.firstCall.args[0]).to.equal(409);
    expect(reinstate.called).to.equal(false);
  });

  it("reinstates every candidate when no period is taken", async function () {
    CheckoutDataProvider.fromCheckoutService.resolves(
      memoryOf({ bookingsByBookableId: { "room-a": [CANCELLED, FREE] } }),
    );
    const res = response();

    await GroupBookingController.reinstateGroupBooking(groupRequest(), res);

    expect(reinstate.firstCall.args[2].bookingIds).to.deep.equal([
      "B-OLD",
      "B-FREE",
    ]);
    expect(res.status.lastCall.args[0]).to.equal(200);
  });
});
