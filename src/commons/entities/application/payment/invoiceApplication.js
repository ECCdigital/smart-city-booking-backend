const PaymentApplication = require("./paymentApplication");
const SecurityUtils = require("../../../utilities/security-utils");

/** The tenant's bank account: stored only encrypted (ECCdigital/tickets#16). */
const ACCOUNT_FIELDS = Object.freeze(["bank", "iban", "bic", "accountHolder"]);

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

  /**
   * Encrypts the account fields read in plain text. A value that is not
   * text - an object sent as if encrypted, say - is refused, so nothing
   * unreadable is stored.
   *
   * @throws {Error} For a value that is not text, or without `CRYPTO_SECRET`
   */
  encrypt() {
    for (const field of ACCOUNT_FIELDS) {
      if (!this[field]) continue;
      if (typeof this[field] !== "string") {
        throw new Error(`invoice application: ${field} must be text`);
      }
      this[field] = SecurityUtils.encrypt(this[field]);
    }
  }

  /** A field in plain text, from before the migration, stays as it is. */
  decrypt() {
    for (const field of ACCOUNT_FIELDS) {
      if (SecurityUtils.isEncrypted(this[field])) {
        this[field] = SecurityUtils.decrypt(this[field]);
      }
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      bank: { type: Object, default: "" },
      iban: { type: Object, default: "" },
      bic: { type: Object, default: "" },
      accountHolder: { type: Object, default: "" },
      daysUntilPaymentDue: { type: Number, default: null },
      permittedUsers: { type: [String], default: [] },
      permittedRoles: { type: [String], default: [] },
      manualCreation: { type: Boolean, default: false },
    };
  }
}

module.exports = InvoiceApplication;
module.exports.ACCOUNT_FIELDS = ACCOUNT_FIELDS;
