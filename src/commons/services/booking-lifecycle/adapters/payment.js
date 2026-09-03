/**
 * The payment adapter of the booking lifecycle seam: the payment request
 * (glossary "Zahlungsaufforderung") of the tenant's payment provider behind
 * one operation (spec part 2, section 7). The provider's way of asking -
 * a link, an issued invoice, an "invoice follows" - stays with the payment
 * seam. A tenant without a payment service, or a booking without a
 * payment provider, answers the step as skipped.
 */

const PaymentUtils = require("../../../utilities/payment-utils");
const { SKIPPED } = require("../pipeline");

const payment = {
  /**
   * @param {{ tenantId: string, bookingIds: string[], paymentProvider: string, groupBookingId?: string|null }} params
   * @returns {Promise<*>} What the provider answers, or `SKIPPED`
   */
  async requestPayment({
    tenantId,
    bookingIds,
    paymentProvider,
    groupBookingId = null,
  }) {
    if (!paymentProvider) {
      return SKIPPED;
    }
    const aggregated = Boolean(groupBookingId);
    const paymentService = await PaymentUtils.getPaymentService(
      tenantId,
      aggregated ? bookingIds : bookingIds[0],
      paymentProvider,
      { aggregated, groupBookingId },
    );
    if (!paymentService) {
      return SKIPPED;
    }
    return await paymentService.paymentRequest();
  },
};

module.exports = payment;
