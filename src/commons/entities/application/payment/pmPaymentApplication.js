const PaymentApplication = require("./paymentApplication");
const SecurityUtils = require("../../../utilities/security-utils");

class PmPaymentApplication extends PaymentApplication {
  constructor(params) {
    super({ id: "pmPayment", title: "pmPayment", ...params });
    this.paymentMerchantId = params.paymentMerchantId || null;
    this.paymentProjectId = params.paymentProjectId || null;
    this.paymentSecret = params.paymentSecret || null;
    this.paymentMode = params.paymentMode || "";
  }

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
      paymentMerchantId: { type: Object, default: null },
      paymentProjectId: { type: Object, default: null },
      paymentSecret: { type: Object, default: null },
      paymentMode: { type: String, default: "" },
    };
  }
}

module.exports = PmPaymentApplication;
