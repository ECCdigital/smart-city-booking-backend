/**
 * The payment adapter of the booking lifecycle seam: the payment request
 * (glossary "Zahlungsaufforderung") of the tenant's payment provider behind
 * one operation (spec part 2, section 7; mail-stack spec, section 4). The
 * provider answers the form of the request as a value - `{ form: "link" |
 * "invoice" | "pending", paymentUrl?, files? }` - and the lifecycle sends
 * the notice of that form; the issuing of an invoice stays with the
 * provider. A tenant without a payment service, or a booking without a
 * payment provider, answers the step as skipped.
 */

const PaymentUtils = require("../../../utilities/payment-utils");
const { SKIPPED } = require("../pipeline");

const payment = {
  /**
   * @param {{ tenantId: string, bookingIds: string[], paymentProvider: string, groupBookingId?: string|null }} params
   * @returns {Promise<{ form: string, paymentUrl?: string, files?: Object[] }|symbol>}
   *   The provider's answer, or `SKIPPED`
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
