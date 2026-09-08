const assert = require("assert");
const sinon = require("sinon");
const DashboardManager = require("../src/commons/data-managers/dashboard-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const {
  BOOKING_STATUS_I18N,
} = require("../src/commons/services/booking/booking-status-keys");

function stubAggregate(sandbox, bookingRows, cancellationRows) {
  const aggregate = sandbox.stub(BookingModel, "aggregate");
  aggregate.onFirstCall().returns({
    exec: sandbox.stub().resolves(bookingRows),
  });
  if (cancellationRows !== undefined) {
    aggregate.onSecondCall().returns({
      exec: sandbox.stub().resolves(cancellationRows),
    });
  }
  return aggregate;
}

function stubLiveBookables(sandbox, bookables) {
  sandbox.stub(BookableModel, "find").returns({
    lean: sandbox.stub().resolves(bookables),
  });
}

describe("DashboardManager.aggregateByBookable", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("uses the live bookable title when the bookable still exists", async function () {
    stubAggregate(
      sandbox,
      [
        {
          _id: "room-a",
          bookings: 4,
          bookableTitle: "Old Room A",
        },
      ],
      undefined,
    );
    stubLiveBookables(sandbox, [{ id: "room-a", title: "Room A renamed" }]);

    const rows = await DashboardManager.aggregateByBookable({
      tenantId: "demo",
      statusKeys: [BOOKING_STATUS_I18N.PAID_COMPLETED],
    });

    assert.deepStrictEqual(rows, [
      {
        bookableId: "room-a",
        bookableTitle: "Room A renamed",
        bookableDeleted: false,
        bookings: 4,
        cancellations: 0,
      },
    ]);
  });

  it("falls back to the booking snapshot title when the bookable was deleted", async function () {
    stubAggregate(
      sandbox,
      [
        {
          _id: "gone-room",
          bookings: 2,
          bookableTitle: "Former Room",
        },
      ],
      undefined,
    );
    stubLiveBookables(sandbox, []);

    const rows = await DashboardManager.aggregateByBookable({
      tenantId: "demo",
      statusKeys: [BOOKING_STATUS_I18N.PAID_COMPLETED],
    });

    assert.deepStrictEqual(rows, [
      {
        bookableId: "gone-room",
        bookableTitle: "Former Room",
        bookableDeleted: true,
        bookings: 2,
        cancellations: 0,
      },
    ]);
  });

  it("falls back to bookableId when the snapshot title is missing", async function () {
    stubAggregate(
      sandbox,
      [{ _id: "legacy-id", bookings: 1, bookableTitle: null }],
      undefined,
    );
    stubLiveBookables(sandbox, []);

    const rows = await DashboardManager.aggregateByBookable({
      tenantId: "demo",
      statusKeys: [BOOKING_STATUS_I18N.PAID_COMPLETED],
    });

    assert.strictEqual(rows[0].bookableTitle, "legacy-id");
    assert.strictEqual(rows[0].bookableDeleted, true);
  });

  it("uses the cancellation snapshot title for deleted bookables with only cancellations", async function () {
    stubAggregate(
      sandbox,
      [],
      [
        {
          _id: "gone-room",
          cancellations: 3,
          bookableTitle: "Cancelled Room",
        },
      ],
    );
    stubLiveBookables(sandbox, []);

    const rows = await DashboardManager.aggregateByBookable({
      tenantId: "demo",
    });

    assert.deepStrictEqual(rows, [
      {
        bookableId: "gone-room",
        bookableTitle: "Cancelled Room",
        bookableDeleted: true,
        bookings: 0,
        cancellations: 3,
      },
    ]);
  });
});
