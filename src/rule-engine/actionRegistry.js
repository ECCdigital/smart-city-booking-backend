const BookingService = require("../commons/services/checkout/booking-service");

module.exports = {
  test(doc, params) {
    return "test";
  },

  async cancelBooking(doc, params) {
    const bookingId = doc.id;
    const tenantId = doc.tenantId;
    const reason = params.reason || "";

    await BookingService.rejectBooking(tenantId, bookingId, reason);
  },
};
