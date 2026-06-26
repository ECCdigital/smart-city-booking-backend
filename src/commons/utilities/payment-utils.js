const {
  GiroCockpitPaymentService,
  PmPaymentService,
  InvoicePaymentService,
  EPayBLPaymentService,
} = require("../services/payment/providers");
const TenantManager = require("../data-managers/tenant-manager");
const MembershipManager = require("../data-managers/membership-manager");

class PaymentUtils {
  /**
   * Checks whether a user is permitted to use invoice payment for a given tenant.
   * If the InvoiceApplication has no permittedUsers and no permittedRoles configured,
   * access is unrestricted (returns true for everyone).
   *
   * @param {string} tenantId
   * @param {string|null} userId
   * @returns {Promise<boolean>}
   */
  static async checkInvoicePermission(tenantId, userId) {
    const invoiceApp = await TenantManager.getTenantApp(tenantId, "invoice");
    if (!invoiceApp || !invoiceApp.active) return false;

    const permittedUsers = invoiceApp.permittedUsers || [];
    const permittedRoles = invoiceApp.permittedRoles || [];

    // No restrictions configured → everyone is allowed
    if (permittedUsers.length === 0 && permittedRoles.length === 0) {
      return true;
    }

    // No user logged in → not allowed
    if (!userId) return false;

    // Resolve users that have one of the permitted roles
    const roleMembers = await MembershipManager.getMembershipsByTenantAndRoles(
      tenantId,
      permittedRoles,
    );

    const allPermittedUserIds = [
      ...permittedUsers,
      ...roleMembers.map((m) => m.userId),
    ];

    return allPermittedUserIds.includes(userId);
  }

  static async getPaymentService(
    tenantId,
    bookingId,
    paymentProvider,
    options,
  ) {
    const paymentProviders = {
      girocockpit: {
        serviceClass: GiroCockpitPaymentService,
        name: "giroCockpit",
      },
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
