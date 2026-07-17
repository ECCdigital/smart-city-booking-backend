const assert = require("assert");
const sinon = require("sinon");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const {
  GroupBookingController,
} = require("../src/platform/api/controllers/group-booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const BookingService = require("../src/commons/services/checkout/booking-service");

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    send: sandbox.stub().returnsThis(),
    sendStatus: sandbox.stub().returnsThis(),
    json: sandbox.stub().returnsThis(),
  };
}

describe("cancellation refund controllers", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("returns an authorized single-booking refund preview", async function () {
    const booking = { id: "booking-1", tenantId: "tenant-1" };
    const preview = {
      bookingId: "booking-1",
      appliedRefundPercentage: 50,
    };
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    sandbox.stub(PermissionsService, "_allowUpdate").resolves(true);
    sandbox
      .stub(BookingService, "getCancellationRefundPreview")
      .resolves(preview);
    const res = response(sandbox);

    await BookingController.getCancellationRefundPreview(
      {
        params: { tenant: "tenant-1", id: "booking-1" },
        user: { id: "admin-1" },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    assert.strictEqual(res.send.calledWith(preview), true);
  });

  it("denies a single-booking refund preview without permission", async function () {
    sandbox
      .stub(BookingManager, "getBooking")
      .resolves({ id: "booking-1", tenantId: "tenant-1" });
    sandbox.stub(PermissionsService, "_allowUpdate").resolves(false);
    const preview = sandbox.stub(
      BookingService,
      "getCancellationRefundPreview",
    );
    const res = response(sandbox);

    await BookingController.getCancellationRefundPreview(
      {
        params: { tenant: "tenant-1", id: "booking-1" },
        user: { id: "admin-1" },
      },
      res,
    );

    assert.strictEqual(res.sendStatus.calledWith(403), true);
    assert.strictEqual(preview.called, false);
  });

  it("rejects an invalid single-booking admin override", async function () {
    const res = response(sandbox);

    await BookingController.rejectBooking(
      {
        params: { tenant: "tenant-1", id: "booking-1" },
        user: { id: "admin-1" },
        body: { refundPercentage: 50.5 },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(400), true);
    assert.strictEqual(res.send.calledWith("invalid_refund_percentage"), true);
  });

  it("returns an authorized group refund preview", async function () {
    const groupBooking = { id: "group-1", tenantId: "tenant-1" };
    const preview = { groupBookingId: "group-1", bookings: [] };
    sandbox.stub(GroupBookingManager, "getGroupBooking").resolves(groupBooking);
    sandbox.stub(PermissionsService, "_allowUpdate").resolves(true);
    sandbox
      .stub(BookingService, "getGroupCancellationRefundPreview")
      .resolves(preview);
    const res = response(sandbox);

    await GroupBookingController.getCancellationRefundPreview(
      {
        params: { tenant: "tenant-1", id: "group-1" },
        user: { id: "admin-1" },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    assert.strictEqual(res.send.calledWith(preview), true);
  });

  it("returns a public refund preview when ownership matches", async function () {
    const preview = {
      bookingId: "booking-1",
      originalAmountEur: 100,
      refundAmountEur: 50,
      cancellationFeeEur: 50,
      suggestedRefundPercentage: 50,
      appliedRefundPercentage: 50,
      daysBeforeStart: 5,
      appliedTierDays: 0,
    };
    sandbox
      .stub(BookingService, "getPublicCancellationRefundPreview")
      .resolves(preview);
    const res = response(sandbox);

    await BookingController.getPublicCancellationRefundPreview(
      {
        params: { tenant: "tenant-1", id: "booking-1" },
        query: { name: "Max Mustermann" },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    assert.strictEqual(res.send.calledWith(preview), true);
  });

  it("rejects a public refund preview without a name", async function () {
    const preview = sandbox.stub(
      BookingService,
      "getPublicCancellationRefundPreview",
    );
    const res = response(sandbox);

    await BookingController.getPublicCancellationRefundPreview(
      {
        params: { tenant: "tenant-1", id: "booking-1" },
        query: {},
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(400), true);
    assert.strictEqual(preview.called, false);
  });

  it("returns a hook-scoped refund preview", async function () {
    const preview = {
      bookingId: "booking-1",
      originalAmountEur: 80,
      refundAmountEur: 80,
      cancellationFeeEur: 0,
      suggestedRefundPercentage: 100,
      appliedRefundPercentage: 100,
    };
    sandbox
      .stub(BookingService, "getHookCancellationRefundPreview")
      .resolves(preview);
    const res = response(sandbox);

    await BookingController.getHookCancellationRefundPreview(
      {
        params: {
          tenant: "tenant-1",
          id: "booking-1",
          hookId: "hook-1",
        },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    assert.strictEqual(res.send.calledWith(preview), true);
  });
});
