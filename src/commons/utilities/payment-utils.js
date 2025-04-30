const {
  GiroCockpitPaymentService,
  PmPaymentService,
  InvoicePaymentService,
} = require("../services/payment/payment-service");
const TenantManager = require("../data-managers/tenant-manager");

class PaymentUtils {
  static async getPaymentService(
    tenantId,
    bookingId,
    paymentProvider,
    options,
  ) {
    const paymentProviders = {
      giroCockpit: GiroCockpitPaymentService,
      pmPayment: PmPaymentService,
      invoice: InvoicePaymentService,
    };
    const serviceClass = paymentProviders[paymentProvider];
    if (!serviceClass) return null;

    const paymentApp = await TenantManager.getTenantApp(
      tenantId,
      paymentProvider,
    );
    if (!paymentApp || !paymentApp.active) {
      throw new Error(`${paymentProvider} payment app not found or inactive.`);
    }

    return new serviceClass(tenantId, bookingId, options);
  }
}

module.exports = PaymentUtils;
