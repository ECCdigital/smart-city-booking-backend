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

const SALTO_KS_ENVIRONMENTS = ["accept", "production"];
const DEFAULT_SALTO_KS_ENVIRONMENT = "accept";

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
    // Which Salto installation the tenant talks to. The Connect API base URL
    // and identity server follow from it (see salto-ks-api-client), so the
    // free-text `apiBaseUrl` of earlier versions is no longer used - it is only
    // read once to tell what environment an old configuration meant.
    this.environment = SaltoKsAccessApplication.resolveEnvironment(params);
    // One entry per IQ the system user was activated at - the site has one
    // Salto application per tenant, so the activations live here, not at the
    // access point. `secret` and `pin` are the OTP ingredients; they stay
    // encrypted even through decrypt(), because unlike clientSecret they are
    // never round-tripped through an admin UI - only the IQ activation
    // service decrypts them at the moment of use.
    this.iqActivations = Array.isArray(params.iqActivations)
      ? params.iqActivations
      : [];
  }

  /**
   * The environment a Salto KS configuration means - `accept` or
   * `production`.
   *
   * Prefers an explicit `environment`; a configuration from before the switch
   * existed only had `apiBaseUrl`, and an accept host in there meant accept,
   * any other host production. Anything unknown is accept, the safe side.
   *
   * @param {{environment?: string, apiBaseUrl?: string}} params
   * @returns {string}
   */
  static resolveEnvironment({ environment, apiBaseUrl } = {}) {
    const explicit = String(environment || "").toLowerCase();
    if (SALTO_KS_ENVIRONMENTS.includes(explicit)) {
      return explicit;
    }

    const legacyUrl = String(apiBaseUrl || "").toLowerCase();
    if (legacyUrl && !legacyUrl.includes("accept")) {
      return "production";
    }

    return DEFAULT_SALTO_KS_ENVIRONMENT;
  }

  static get environments() {
    return [...SALTO_KS_ENVIRONMENTS];
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
    for (const activation of this.iqActivations || []) {
      if (activation.secret && typeof activation.secret === "string") {
        activation.secret = SecurityUtils.encrypt(activation.secret);
      }
      if (activation.pin && typeof activation.pin === "string") {
        activation.pin = SecurityUtils.encrypt(activation.pin);
      }
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
      environment: {
        type: String,
        enum: SALTO_KS_ENVIRONMENTS,
        default: DEFAULT_SALTO_KS_ENVIRONMENT,
      },
      iqActivations: { type: Array, default: [] },
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
