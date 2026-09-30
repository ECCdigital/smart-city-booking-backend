/**
 * `13-07-2026-add-cancellation-contact-hint` set `cancellationPolicy.contactHint`
 * on bookings stored without a cancellation policy, which left them with
 * `{ contactHint: "" }` only. The schema default `userCancellable: true` no
 * longer applies to those bookings, so customers could not cancel them. Every
 * other write path stores the flag, so a policy without it comes from that
 * migration and gets the default back.
 */
module.exports = {
  name: "30-09-2026-restore-booking-user-cancellable",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    await Booking.updateMany(
      {
        cancellationPolicy: { $type: "object" },
        "cancellationPolicy.userCancellable": { $exists: false },
      },
      { $set: { "cancellationPolicy.userCancellable": true } },
    );
  },

  down: async function () {
    // Not reversible: the restored flag cannot be told apart from one set at checkout.
  },
};
