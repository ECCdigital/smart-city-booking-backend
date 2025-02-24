const Application = require('./application');
const SecurityUtils = require("../../utilities/security-utils");


class AuthApplication extends Application {
  constructor(params) {
    super({type: 'auth', ...params});
    this.serverUrl = params.serverUrl || "";
    this.realm = params.realm || "";
    this.publicClient = params.publicClient || "";
    this.privateClient = params.privateClient || "";
    this.privateClientSecret = params.privateClientSecret || null;
    this.roleMapping = params.roleMapping || {};
  }

  /**
   * Decrypts the private client secret if it exists.
   */
  decrypt() {
    if (this.privateClientSecret) {
      this.privateClientSecret = SecurityUtils.decrypt(this.privateClientSecret);
    }
  }

  /**
   * Encrypts the private client secret if it exists.
   */
  encrypt() {
    if (this.privateClientSecret) {
      this.privateClientSecret = SecurityUtils.encrypt(this.privateClientSecret);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      serverUrl: { type: String, default: "" },
      realm: { type: String, default: "" },
      publicClient: { type: String, default: "" },
      privateClient: { type: String, default: "" },
      privateClientSecret: { type: Object, default: null },
      roleMapping: { type: Object, default: {} },
    };
  }
}


module.exports = AuthApplication;