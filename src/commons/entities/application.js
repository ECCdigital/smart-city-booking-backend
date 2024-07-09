const SecurityUtils = require("../utilities/security-utils");

const APP_IDS = {
  KEYCLOAK: "keycloak",
};

class Application {
  constructor(id, type, active = false) {
    this.id = id;
    this.type = type;
    this.active = active;
  }

  encryptSecret() {
    throw new Error("Method not implemented");
  }

  decryptSecret() {
    throw new Error("Method not implemented");
  }
}

class KeycloakApplication extends Application {
  constructor(
    id,
    type,
    active = false,
    serverUrl,
    realm,
    publicClient,
    privateClient,
    privateClientSecret,
    roleMapping = { active: false, roles: [] },
  ) {
    super(id, type, active);
    this.serverUrl = serverUrl;
    this.realm = realm;
    this.publicClient = publicClient;
    this.privateClient = privateClient;
    this.privateClientSecret = privateClientSecret;
    this.roleMapping = roleMapping;
  }

  encryptSecret() {
    this.privateClientSecret = SecurityUtils.encrypt(this.privateClientSecret);
  }

  decryptSecret() {
    this.privateClientSecret = SecurityUtils.decrypt(this.privateClientSecret);
  }
}

module.exports = { Application, KeycloakApplication, APP_IDS };
