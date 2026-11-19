class TenantApplication {
  constructor({ type, id, active = false, title = "" }) {
    this.type = type;
    this.id = id;
    this.active = active;
    this.title = title;
  }

  decrypt() {}
  encrypt() {}

  /**
   * The application's secrets, each with the fields it belongs to: the
   * server it is sent to and the account it was issued for. The answers
   * never carry a secret (see `StoredSecretService`), and a stored one is
   * kept only while those fields stay the same.
   *
   * @returns {Object<string, string[]>}
   */
  static get secrets() {
    return {};
  }

  static get Schema() {
    return {
      type: {
        type: String,
        required: true,
        enum: ["auth", "payment", "access"],
      },
      id: { type: String, required: true },
      active: { type: Boolean, default: false },
      title: { type: String, default: "" },
    };
  }
}

module.exports = TenantApplication;
