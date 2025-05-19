const SsoApplication = require("./ssoApplication");
const SecurityUtils = require("../../utilities/security-utils");

class KeycloakSsoApplication extends SsoApplication {
  constructor(params) {
    super(params);
    this.serverUrl = params.serverUrl;
    this.realm = params.realm;
    this.publicClient = params.publicClient;
    this.privateClient = params.privateClient;
    this.privateClientSecret = params.privateClientSecret;
    this.roleMapping = params.roleMapping;
  }

  decrypt() {
    if (this.privateClientSecret) {
      this.privateClientSecret = SecurityUtils.decrypt(
        this.privateClientSecret,
      );
    }
  }

  encrypt() {
    if (this.privateClientSecret) {
      this.privateClientSecret = SecurityUtils.encrypt(
        this.privateClientSecret,
      );
    }
  }

  removePrivateData() {
    delete this.privateClientSecret;
    delete this.privateClient;
    delete this.roleMapping;
  }
}

module.exports = KeycloakSsoApplication;
