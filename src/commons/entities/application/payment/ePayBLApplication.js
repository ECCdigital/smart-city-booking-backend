const PaymentApplication = require("./paymentApplication");
const SecurityUtils = require("../../../utilities/security-utils");

class EPayBLApplication extends PaymentApplication {
  constructor(params) {
    super({ id: "ePayBL", title: "ePayBL", ...params });
    this.baseUrl = params.baseUrl || "";
    this.merchantId = params.merchantId || "";
    this.managerId = params.managerId || "";
    this.budgetAccount = params.budgetAccount || "";
    this.objectNumber = params.objectNumber || "";
    this.paymentMethods = params.paymentMethods || [];
    this.clientP12 = params.clientP12 || "";
    this.certPassphrase = params.certPassphrase || "";
    this.notificationSecret = params.notificationSecret || "";
  }

  decrypt() {
    if (this.certPassphrase) {
      this.certPassphrase = SecurityUtils.decrypt(this.certPassphrase);
    }
    if (this.clientP12) {
      this.clientP12 = SecurityUtils.decrypt(this.clientP12);
    }

    if (this.notificationSecret) {
      this.notificationSecret = SecurityUtils.decrypt(this.notificationSecret);
    }
  }

  encrypt() {
    if (this.certPassphrase) {
      this.certPassphrase = SecurityUtils.encrypt(this.certPassphrase);
    }
    if (this.clientP12) {
      this.clientP12 = SecurityUtils.encrypt(this.clientP12);
    }

    if (this.notificationSecret) {
      this.notificationSecret = SecurityUtils.encrypt(this.notificationSecret);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      baseUrl: { type: String, default: "" },
      merchantId: { type: String, default: "" },
      managerId: { type: String, default: "" },
      budgetAccount: { type: String, default: "" },
      objectNumber: { type: String, default: "" },
      paymentMethods: { type: [String], default: [] },
      clientP12: { type: Object, default: null },
      certPassphrase: { type: Object, default: null },
      notificationSecret: { type: Object, default: null },
    };
  }
}

module.exports = EPayBLApplication;
