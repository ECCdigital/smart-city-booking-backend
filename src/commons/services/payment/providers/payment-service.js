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

  /**
   * A successful payment is the transition `pay` of the lifecycle, set off
   * by the payment (glossary "Auslöser"): of the group the webhook names
   * or the first booking belongs to where the payment was aggregated, of
   * every booking named otherwise. The lifecycle's guard - a booking paid
   * already, a group whose members differ in state - and a missing
   * booking or group throw as the 409 and 404 they are.
   */
  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    const {
      bookingLifecycle,
      groupBookingLifecycle,
      TRIGGER,
    } = require("../../booking-lifecycle");
    if (this.aggregated) {
      const { groupBookingIdOf } = require("../../documents/document-issuance");
      const groupBookingId = await groupBookingIdOf({
        tenantId,
        bookingIds,
        groupBookingId: this.groupBookingId,
      });
      await groupBookingLifecycle.pay(tenantId, groupBookingId, {
        trigger: TRIGGER.PAYMENT,
        paymentMethod,
      });
    } else {
      for (const bookingId of bookingIds) {
        await bookingLifecycle.pay(tenantId, bookingId, {
          trigger: TRIGGER.PAYMENT,
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
