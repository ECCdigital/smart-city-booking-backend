const Application = require("./application");
const SecurityUtils = require("../../utilities/security-utils");

class LockerApplication extends Application {
  constructor(params) {
    super({ type: "locker", ...params });
    this.version = params.version || 1;
    this.apiKey = params.apiKey || "";
    this.lockerId = params.lockerId || "";
    this.serverUrl = params.serverUrl || "";
    this.user = params.user || "";
    this.password = params.password || null;
  }

  /**
   * Decrypts the password if it exists.
   */
  decrypt() {
    if (this.password) {
      this.password = SecurityUtils.decrypt(this.password);
    }
  }

  /**
   * Encrypts the password if it exists.
   */
  encrypt() {
    if (this.password) {
      this.password = SecurityUtils.encrypt(this.password);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      version: { type: Number, default: 1 },
      apiKey: { type: String, default: "" },
      lockerId: { type: String, default: "" },
      serverUrl: { type: String, default: "" },
      user: { type: String, default: "" },
      password: { type: Object, default: null },
    };
  }
}

module.exports = LockerApplication;
