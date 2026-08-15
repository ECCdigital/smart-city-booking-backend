const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

class AccessApplication extends TenantApplication {
  constructor(params) {
    super({ type: "access", ...params });
    this.apiBaseUrl = params.apiBaseUrl || "";
    this.webhookCallbackUrl = params.webhookCallbackUrl || null;
    this.webhookSubscriptionId = params.webhookSubscriptionId || null;
    this.webhookRegisteredAt = params.webhookRegisteredAt || null;
    this.webhookRegistrationError = params.webhookRegistrationError || null;
  }

  decrypt() {}

  encrypt() {}

  static get Schema() {
    return {
      ...super.Schema,
      apiBaseUrl: { type: String, default: "" },
      webhookCallbackUrl: { type: String, default: null },
      webhookSubscriptionId: { type: String, default: null },
      webhookRegisteredAt: { type: Number, default: null },
      webhookRegistrationError: { type: String, default: null },
    };
  }
}

class NukiAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.apiToken = params.apiToken || null;
    this.apiBaseUrl = params.apiBaseUrl || "https://api.nuki.io";
  }

  decrypt() {
    if (this.apiToken?.iv != null && this.apiToken?.data != null) {
      this.apiToken = SecurityUtils.decrypt(this.apiToken);
    }
  }

  encrypt() {
    if (this.apiToken && typeof this.apiToken === "string") {
      this.apiToken = SecurityUtils.encrypt(this.apiToken);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      apiToken: { type: Object, default: null },
      apiBaseUrl: { type: String, default: "https://api.nuki.io" },
    };
  }
}

class SaltoKsAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.clientId = params.clientId || null;
    this.clientSecret = params.clientSecret || null;
    // Salto KS backend-server integrations use the OAuth password grant, which
    // requires the credentials of a predefined KS system user (site_admin).
    this.username = params.username || null;
    this.password = params.password || null;
    this.siteId = params.siteId || null;
    this.apiBaseUrl =
      params.apiBaseUrl || "https://clp-accept-user.saltoks.com";
  }

  decrypt() {
    if (this.clientSecret?.iv != null && this.clientSecret?.data != null) {
      this.clientSecret = SecurityUtils.decrypt(this.clientSecret);
    }
    if (this.password?.iv != null && this.password?.data != null) {
      this.password = SecurityUtils.decrypt(this.password);
    }
  }

  encrypt() {
    if (this.clientSecret && typeof this.clientSecret === "string") {
      this.clientSecret = SecurityUtils.encrypt(this.clientSecret);
    }
    if (this.password && typeof this.password === "string") {
      this.password = SecurityUtils.encrypt(this.password);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      clientId: { type: String, default: null },
      clientSecret: { type: Object, default: null },
      username: { type: String, default: null },
      password: { type: Object, default: null },
      siteId: { type: String, default: null },
      apiBaseUrl: {
        type: String,
        default: "https://clp-accept-user.saltoks.com",
      },
    };
  }
}

const accessAppTypes = {
  nuki: NukiAccessApplication,
  "salto-ks": SaltoKsAccessApplication,
};

function createAccessApplication(params) {
  const AppClass = accessAppTypes[params.id] || AccessApplication;
  return new AppClass(params);
}

function registerAccessAppType(id, AppClass) {
  accessAppTypes[id] = AppClass;
}

module.exports = {
  AccessApplication,
  NukiAccessApplication,
  SaltoKsAccessApplication,
  accessAppTypes,
  createAccessApplication,
  registerAccessAppType,
};
