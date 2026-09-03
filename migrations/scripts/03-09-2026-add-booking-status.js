/**
 * Gives every booking its stored state, `status`, read off the three flags
 * the way the BookingLifecycle spec reads them (part 1, 3.3):
 *
 *   isRejected && !isCommitted                  ->  rejected
 *   isRejected && isCommitted                   ->  cancelled
 *   !isCommitted                                ->  requested
 *   isCommitted && priceEur > 0 && !isPayed     ->  payment_due
 *   otherwise                                   ->  confirmed
 *
 * "Paid but never confirmed" of a priced booking is a combination the state
 * model does not have; it becomes `confirmed` (the payment is the stronger
 * statement) and is counted in the log. A cancelled booking additionally
 * gets `cancellationRefund.cancelledFrom`, the state it was cancelled from
 * (`confirmed` where paid or free, else `payment_due`), which `reinstate`
 * returns to; a missing `cancellationRefund` is created with just that.
 *
 * Idempotent: only bookings without a `status` are touched. `down` removes
 * `status` and `cancelledFrom` again (a `cancellationRefund` that held
 * nothing else goes with it); the flags stand throughout.
 */

const {
  STATUS,
  statusFromFlags,
  cancelledFromFlags,
  isImpossibleFlagCombination,
} = require("../../src/commons/services/booking-lifecycle/booking-state");

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function flagsOf(booking) {
  return {
    isCommitted: Boolean(booking.isCommitted),
    isPayed: Boolean(booking.isPayed),
    isRejected: Boolean(booking.isRejected),
  };
}

module.exports = {
  name: "03-09-2026-add-booking-status",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find({ status: { $exists: false } }).lean();

    let impossible = 0;

    for (const booking of bookings) {
      const flags = flagsOf(booking);
      const priceEur = Number(booking.priceEur) || 0;
      const status = statusFromFlags(flags, priceEur);

      if (isImpossibleFlagCombination(flags, priceEur)) {
        impossible += 1;
      }

      const $set = { status };
      if (
        status === STATUS.CANCELLED &&
        booking.cancellationRefund?.cancelledFrom == null
      ) {
        $set["cancellationRefund.cancelledFrom"] = cancelledFromFlags(
          flags,
          priceEur,
        );
      }

      await Booking.updateOne({ _id: booking._id }, { $set });
    }

    console.log(
      `03-09-2026-add-booking-status: ${bookings.length} bookings given a status`,
    );
    if (impossible > 0) {
      console.warn(
        `03-09-2026-add-booking-status: ${impossible} bookings were paid but ` +
          `never confirmed; they read as confirmed`,
      );
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find({ status: { $exists: true } }).lean();

    for (const booking of bookings) {
      const $unset = { status: "" };
      const refund = booking.cancellationRefund;

      if (refund && hasOwn(refund, "cancelledFrom")) {
        const onlyCancelledFrom = Object.keys(refund).every(
          (key) => key === "cancelledFrom",
        );
        $unset[
          onlyCancelledFrom
            ? "cancellationRefund"
            : "cancellationRefund.cancelledFrom"
        ] = "";
      }

      await Booking.updateOne({ _id: booking._id }, { $unset });
    }
  },
};
