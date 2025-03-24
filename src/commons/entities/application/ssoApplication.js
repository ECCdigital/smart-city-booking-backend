const InstanceApplication = require("./InstanceApplication");
const KeycloakSsoApplication = require("./keycloakSsoApplication");

class SsoApplication extends InstanceApplication {
  constructor(params) {
    super({ type: "auth", ...params });
  }

  decrypt() {
    /* ... */
  }
  encrypt() {
    /* ... */
  }
  removePrivateData() {
    /* ... */
  }

  static init(params) {
    switch (params.id) {
      case "keycloak":
        return new KeycloakSsoApplication(params);
      default:
        throw new Error(`Unbekannte SSO-ID: ${params.id}`);
    }
  }
}

module.exports = SsoApplication;
