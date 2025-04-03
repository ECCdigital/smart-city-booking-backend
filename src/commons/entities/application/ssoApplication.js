const InstanceApplication = require("./instanceApplication");

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
        const KeycloakSsoApplication = require("./keycloakSsoApplication");
        return new KeycloakSsoApplication(params);
      default:
        throw new Error(`Unbekannte SSO-ID: ${params.id}`);
    }
  }
}

module.exports = SsoApplication;
