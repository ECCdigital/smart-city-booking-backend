const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "payment-service",
  level: process.env.LOG_LEVEL,
});

class PaymentService {
  /**
   * @param {string} tenantId
   * @param {string|string[]} bookingIds
   * @param {object} [options]
   */
  constructor(tenantId, bookingIds, options = {}) {
    this.tenantId = tenantId;
    this.bookingIds = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    this.aggregated = !!options.aggregated;
    this.groupBookingId = options.groupBookingId || null;
  }

  createPayment() {
    throw new Error("createPayment not implemented");
  }

  createSeparateInvoices() {
    throw new Error("createSeparateInvoices not implemented");
  }

  createAggregatedInvoice() {
    throw new Error("createAggregatedInvoice not implemented");
  }

  paymentNotification() {
    throw new Error("paymentNotification not implemented");
  }

  async paymentResponse() {
    const InstanceManager = require("../../../data-managers/instance-manager");
    const instance = await InstanceManager.getInstance();

    let checkoutUrl;

    if (
      instance &&
      !instance.checkout.useLegacyCheckout &&
      instance.checkout.checkoutUrl
    ) {
      checkoutUrl = `${instance.checkout.checkoutUrl}/checkout/status?bookingId=${this.bookingIds.join(",")}&tenantId=${this.tenantId}`;
    } else {
      checkoutUrl =
        `${process.env.FRONTEND_URL}/checkout/status` +
        `?ids=${this.bookingIds.join(",")}&tenant=${this.tenantId}`;
    }

    return checkoutUrl;
  }

  paymentRequest() {
    throw new Error("paymentRequest not implemented");
  }

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    const BookingService = require("../../checkout/booking-service");
    if (this.aggregated) {
      await BookingService.setAggregatedBookingPayed({
        tenantId,
        bookingIds,
        paymentMethod,
      });
    } else {
      for (const bookingId of bookingIds) {
        await BookingService.setBookingPayed({
          tenantId,
          bookingId,
          paymentMethod,
        });
      }
    }
  }

  async testConnection() {
    return { success: true, message: "Connection successful" };
  }
}

module.exports = PaymentService;
