const PaymentApplication = require("./paymentApplication");

class InvoiceApplication extends PaymentApplication {
  constructor(params) {
    super({ id: "invoice", title: "Rechnung", ...params });
    this.bank = params.bank || "";
    this.iban = params.iban || "";
    this.bic = params.bic || "";
    this.accountHolder = params.accountHolder || "";
    this.daysUntilPaymentDue = params.daysUntilPaymentDue ?? null;
    this.permittedUsers = params.permittedUsers || [];
    this.permittedRoles = params.permittedRoles || [];
    this.manualCreation = params.manualCreation ?? false;
  }


  static get Schema() {
    return {
      ...super.Schema,
      bank: { type: String, default: "" },
      iban: { type: String, default: "" },
      bic: { type: String, default: "" },
      accountHolder: { type: String, default: "" },
      daysUntilPaymentDue: { type: Number, default: null },
      permittedUsers: { type: [String], default: [] },
      permittedRoles: { type: [String], default: [] },
      manualCreation: { type: Boolean, default: false },
    };
  }
}

module.exports = InvoiceApplication;