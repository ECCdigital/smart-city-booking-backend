const {
  GiroCockpitPaymentService,
  PmPaymentService,
  InvoicePaymentService,
  EPayBLPaymentService,
} = require("../services/payment/providers");
const TenantManager = require("../data-managers/tenant-manager");

class PaymentUtils {
  static async getPaymentService(tenantId, bookingId, paymentProvider, options) {
    const paymentProviders = {
      girocockpit: { serviceClass: GiroCockpitPaymentService, name: "giroCockpit" },
      pmpayment: { serviceClass: PmPaymentService, name: "pmPayment" },
      invoice: { serviceClass: InvoicePaymentService, name: "invoice" },
      epaybl: { serviceClass: EPayBLPaymentService, name: "ePayBL" },
    };

    const provider = paymentProviders[paymentProvider.toLowerCase()];
    if (!provider) return null;

    const paymentApp = await TenantManager.getTenantApp(
      tenantId,
      provider.name,
    );
    if (!paymentApp || !paymentApp.active) {
      throw new Error(`${provider.name} payment app not found or inactive.`);
    }

    return new provider.serviceClass(tenantId, bookingId, options);
  }
}

module.exports = PaymentUtils;
