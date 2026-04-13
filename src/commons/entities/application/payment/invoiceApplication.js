const PaymentApplication = require("./paymentApplication");

class InvoiceApplication extends PaymentApplication {
  constructor(params) {
    super({ id: "invoice", title: "Rechnung", ...params });
    this.bank = params.bank || "";
    this.iban = params.iban || "";
    this.bic = params.bic || "";
    this.accountHolder = params.accountHolder || "";
    this.daysUntilPaymentDue = params.daysUntilPaymentDue ?? null;
  }


  static get Schema() {
    return {
      ...super.Schema,
      bank: { type: String, default: "" },
      iban: { type: String, default: "" },
      bic: { type: String, default: "" },
      accountHolder: { type: String, default: "" },
      daysUntilPaymentDue: { type: Number, default: null },
    };
  }
}

module.exports = InvoiceApplication;