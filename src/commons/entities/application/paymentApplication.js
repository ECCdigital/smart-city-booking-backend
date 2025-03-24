const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

class PaymentApplication extends TenantApplication {
  constructor(params) {
    super({ type: "payment", ...params });
    this.bank = params.bank || "";
    this.iban = params.iban || "";
    this.bic = params.bic || "";
    this.accountHolder = params.accountHolder || "";
    this.daysUntilPaymentDue = params.daysUntilPaymentDue ?? null;
    this.paymentMerchantId = params.paymentMerchantId || null;
    this.paymentProjectId = params.paymentProjectId || null;
    this.paymentSecret = params.paymentSecret || null;
    this.paymentMode = params.paymentMode || "";
    this.paymentPurposeSuffix = params.paymentPurposeSuffix || "";
  }

  /**
   * Decrypts the payment-related secrets if they exist.
   */
  decrypt() {
    if (this.paymentSecret) {
      this.paymentSecret = SecurityUtils.decrypt(this.paymentSecret);
    }
    if (this.paymentMerchantId) {
      this.paymentMerchantId = SecurityUtils.decrypt(this.paymentMerchantId);
    }
    if (this.paymentProjectId) {
      this.paymentProjectId = SecurityUtils.decrypt(this.paymentProjectId);
    }
  }

  /**
   * Encrypts the payment-related secrets if they exist.
   */
  encrypt() {
    if (this.paymentSecret) {
      this.paymentSecret = SecurityUtils.encrypt(this.paymentSecret);
    }
    if (this.paymentMerchantId) {
      this.paymentMerchantId = SecurityUtils.encrypt(this.paymentMerchantId);
    }
    if (this.paymentProjectId) {
      this.paymentProjectId = SecurityUtils.encrypt(this.paymentProjectId);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      bank: { type: String, default: "" },
      iban: { type: String, default: "" },
      bic: { type: String, default: "" },
      accountHolder: { type: String, default: "" },
      daysUntilPaymentDue: { type: Number, default: null },
      paymentMerchantId: { type: Object, default: null },
      paymentProjectId: { type: Object, default: null },
      paymentSecret: { type: Object, default: null },
      paymentMode: { type: String, default: "" },
      paymentPurposeSuffix: { type: String, default: "" },
    };
  }
}

module.exports = PaymentApplication;
