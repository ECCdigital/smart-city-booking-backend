/**
 * The payment state at the booking manager: the same atomic write as the
 * refund state's, on the payment fields; and the booker's view without it.
 */

const assert = require("assert");
const sinon = require("sinon");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const { Booking } = require("../src/commons/entities/booking/booking");

const ANY = { reach: "any", userId: "admin-1" };

const doc = (fields) => ({ toEntity: () => new Booking(fields) });

const booking = {
  id: "B-1",
  tenantId: "t1",
  status: "cancelled",
  cancellationRefund: {
    cancelledFrom: "payment_due",
    cancellationFeeEur: 20,
    paymentState: "completed",
    paymentCompletedAt: 2,
    paymentCompletedByUserId: "admin-1",
  },
};

describe("BookingManager.setPaymentState", function () {
  beforeEach(function () {
    sinon.stub(BookingManager, "_enrichBookingsWithCustomFields").resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("completes with one write of the payment fields alone, matching only a booking that carries a payment state", async function () {
    const update = sinon
      .stub(BookingModel, "findOneAndUpdate")
      .resolves(doc(booking));

    await BookingManager.setPaymentState(
      "t1",
      "B-1",
      {
        paymentState: "completed",
        completedAt: 2,
        completedByUserId: "admin-1",
      },
      ANY,
    );

    const [filter, change] = update.firstCall.args;
    assert.deepStrictEqual(filter["cancellationRefund.paymentState"], {
      $exists: true,
      $ne: "completed",
    });
    assert.deepStrictEqual(change, {
      $set: {
        "cancellationRefund.paymentState": "completed",
        "cancellationRefund.paymentCompletedAt": 2,
        "cancellationRefund.paymentCompletedByUserId": "admin-1",
      },
    });
  });

  it("drops moment and person where the mark is taken back", async function () {
    const update = sinon
      .stub(BookingModel, "findOneAndUpdate")
      .resolves(doc(booking));

    await BookingManager.setPaymentState(
      "t1",
      "B-1",
      { paymentState: "open" },
      ANY,
    );

    assert.deepStrictEqual(update.firstCall.args[1], {
      $set: { "cancellationRefund.paymentState": "open" },
      $unset: {
        "cancellationRefund.paymentCompletedAt": "",
        "cancellationRefund.paymentCompletedByUserId": "",
      },
    });
  });

  it("leaves the payment state out of the booker's view", function () {
    const seen = new Booking(booking).hideRefundState();

    assert.deepStrictEqual(Object.keys(seen.cancellationRefund).sort(), [
      "cancellationFeeEur",
      "cancelledFrom",
    ]);
  });
});
