const {
  GiroCockpitPaymentService,
  InvoicePaymentService,
} = require("../services/payment/payment-service");
const TenantManager = require("../data-managers/tenant-manager");

class PaymentUtils {
  static async getPaymentService(tenantId, bookingId, paymentMethod) {
    const paymentMethods = {
      giroCockpit: GiroCockpitPaymentService,
      invoice: InvoicePaymentService,
    };
    const serviceClass = paymentMethods[paymentMethod];
    if (!serviceClass) return null;

    const paymentApp = await TenantManager.getTenantApp(
      tenantId,
      paymentMethod,
    );
    if (!paymentApp || !paymentApp.active) {
      throw new Error(`${paymentMethod} payment app not found or inactive.`);
    }

    return new serviceClass(tenantId, bookingId);
  }
}

module.exports = PaymentUtils;
