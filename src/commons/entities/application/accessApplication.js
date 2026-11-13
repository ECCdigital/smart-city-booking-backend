const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

/** The `type` of every access application among a tenant's applications. */
const ACCESS_APP_TYPE = "access";

function isEncrypted(value) {
  return value?.iv != null && value?.data != null;
}

/**
 * An access application of a tenant: the provider's credentials plus
 * `customerService`, the Provider Support Contact (name, phone, email) the
 * tenant tells its customers to turn to with door or box problems. Every
 * provider may carry one; the tenant's public export hands it out.
 */
class AccessApplication extends TenantApplication {
  constructor(params) {
    super({ type: ACCESS_APP_TYPE, ...params });
    this.apiBaseUrl = params.apiBaseUrl || "";
    this.webhookCallbackUrl = params.webhookCallbackUrl || null;
    this.webhookSubscriptionId = params.webhookSubscriptionId || null;
    this.webhookRegisteredAt = params.webhookRegisteredAt || null;
    this.webhookRegistrationError = params.webhookRegistrationError || null;
    this.customerService = params.customerService || null;
    // The last connection test, the backend's alone to write
    // (`AccessAppLifecycleService.recordTest`): `{ success, testedAt,
    // error, fingerprint }`, the fingerprint a keyed hash of the tested
    // values (`connectionFingerprint`), never the values themselves.
    this.lastTest = params.lastTest || null;
  }

  /**
   * The fields of this provider that hold secrets: stored encrypted, never
   * answered over the API, kept when a save leaves them empty. The one
   * place that names them - encryption, saving, the connection test and
   * the reading of an application all go by it (`secretFieldsOf`).
   *
   * @returns {string[]}
   */
  static get secretFields() {
    return [];
  }

  /**
   * Per secret field the fields that name what it belongs to, in the order
   * they are checked: a connection test takes a stored secret only while
   * each of them is still the stored one (a password belongs to one user
   * at one server).
   *
   * @returns {Object<string, string[]>}
   */
  static get secretIdentity() {
    return {};
  }

  /**
   * The fields the connection test of this provider checks - what its
   * fingerprint is made of.
   *
   * @returns {string[]}
   */
  static get testedFields() {
    return [];
  }

  /**
   * A keyed hash of the tested fields of this application, secrets in plain
   * text, so the last test can tell whether it tested what is stored
   * without keeping the values.
   *
   * @returns {string}
   */
  connectionFingerprint() {
    const values = this.constructor.testedFields.map((field) => {
      const value = isEncrypted(this[field])
        ? SecurityUtils.decrypt(this[field])
        : this[field];
      return [field, String(value ?? "").trim()];
    });
    return SecurityUtils.fingerprint(JSON.stringify(values));
  }

  decrypt() {
    for (const field of this.constructor.secretFields) {
      if (isEncrypted(this[field])) {
        this[field] = SecurityUtils.decrypt(this[field]);
      }
    }
  }

  encrypt() {
    for (const field of this.constructor.secretFields) {
      if (this[field] && typeof this[field] === "string") {
        this[field] = SecurityUtils.encrypt(this[field]);
      }
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      apiBaseUrl: { type: String, default: "" },
      webhookCallbackUrl: { type: String, default: null },
      webhookSubscriptionId: { type: String, default: null },
      webhookRegisteredAt: { type: Number, default: null },
      webhookRegistrationError: { type: String, default: null },
      customerService: { type: Object, default: null },
      lastTest: { type: Object, default: null },
    };
  }
}

class NukiAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.apiToken = params.apiToken || null;
    this.apiBaseUrl = params.apiBaseUrl || "https://api.nuki.io";
  }

  static get secretFields() {
    return ["apiToken"];
  }

  static get secretIdentity() {
    return { apiToken: ["apiBaseUrl"] };
  }

  static get testedFields() {
    return ["apiBaseUrl", "apiToken"];
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

  static get secretFields() {
    return ["clientSecret", "password"];
  }

  /**
   * A client secret is issued for a client id in one environment, a
   * password belongs to a system user in one environment. The site plays no
   * part - a new site needs no new secret.
   */
  static get secretIdentity() {
    return {
      clientSecret: ["environment", "clientId"],
      password: ["environment", "username"],
    };
  }

  static get testedFields() {
    return [
      "environment",
      "clientId",
      "clientSecret",
      "username",
      "password",
      "siteId",
    ];
  }

  encrypt() {
    super.encrypt();
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

/**
 * The iFBS bike box API of a tenant: one server, one API key, and the
 * secret phrase the booking checksums are made with. Configured as a
 * locker application until the locker fold migrated it.
 */
class IfbsAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.serverUrl = params.serverUrl || "";
    this.apiKeyID = params.apiKeyID || "";
    this.apiKey = params.apiKey || null;
    this.secretPhrase = params.secretPhrase || "";
  }

  static get secretFields() {
    return ["apiKey", "secretPhrase"];
  }

  /** An API key is issued under its key id at one server. */
  static get secretIdentity() {
    return { apiKey: ["serverUrl", "apiKeyID"], secretPhrase: ["serverUrl"] };
  }

  static get testedFields() {
    return ["serverUrl", "apiKeyID", "apiKey"];
  }

  static get Schema() {
    return {
      ...super.Schema,
      serverUrl: { type: String, default: "" },
      apiKeyID: { type: String, default: "" },
      apiKey: { type: Object, default: null },
      secretPhrase: { type: Object, default: "" },
    };
  }
}

/**
 * The Pareva locker system of a tenant: one server, one locker system
 * (`lockerId`) whose sizes are the access points, spoken with basic auth.
 * Configured as a locker application until the locker fold migrated it.
 */
class ParevaAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.serverUrl = params.serverUrl || "";
    this.version = params.version || 1;
    this.lockerId = params.lockerId || "";
    this.user = params.user || "";
    this.password = params.password || null;
  }

  static get secretFields() {
    return ["password"];
  }

  static get secretIdentity() {
    return { password: ["serverUrl", "user"] };
  }

  static get testedFields() {
    return ["serverUrl", "lockerId", "user", "password"];
  }

  static get Schema() {
    return {
      ...super.Schema,
      serverUrl: { type: String, default: "" },
      version: { type: Number, default: 1 },
      lockerId: { type: String, default: "" },
      user: { type: String, default: "" },
      password: { type: Object, default: null },
    };
  }
}

/**
 * The Open Locker instance of a tenant, spoken to as the tenant's technical
 * account: the server, the account's e-mail address and its password,
 * stored encrypted like the other providers' secrets.
 */
class OpenLockerAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.serverUrl = params.serverUrl || "";
    this.email = params.email || "";
    this.password = params.password || null;
  }

  static get secretFields() {
    return ["password"];
  }

  static get secretIdentity() {
    return { password: ["serverUrl", "email"] };
  }

  static get testedFields() {
    return ["serverUrl", "email", "password"];
  }

  static get Schema() {
    return {
      ...super.Schema,
      serverUrl: { type: String, default: "" },
      email: { type: String, default: "" },
      password: { type: Object, default: null },
    };
  }
}

const accessAppTypes = {
  nuki: NukiAccessApplication,
  "salto-ks": SaltoKsAccessApplication,
  ifbs: IfbsAccessApplication,
  pareva: ParevaAccessApplication,
  "open-locker": OpenLockerAccessApplication,
};

/**
 * The class of a provider's access application; `AccessApplication` for a
 * provider without a class of its own.
 *
 * @param {string} providerId e.g. `nuki`, `salto-ks`
 * @returns {typeof AccessApplication}
 */
function appClassOf(providerId) {
  return accessAppTypes[providerId] || AccessApplication;
}

function createAccessApplication(params) {
  const AppClass = appClassOf(params.id);
  return new AppClass(params);
}

/**
 * The secret fields of a provider's access application, as its class names
 * them (`secretFields`); none for a provider without a class of its own.
 *
 * @param {string} providerId e.g. `nuki`, `salto-ks`
 * @returns {string[]}
 */
function secretFieldsOf(providerId) {
  return appClassOf(providerId).secretFields ?? [];
}

/**
 * The stored access application of a provider in a tenant, active or not.
 *
 * @param {Object|null} tenant
 * @param {string} providerId
 * @returns {Object|null}
 */
function findAccessApp(tenant, providerId) {
  return (
    (tenant?.applications || []).find(
      (app) => app.type === ACCESS_APP_TYPE && app.id === providerId,
    ) || null
  );
}

function registerAccessAppType(id, AppClass) {
  accessAppTypes[id] = AppClass;
}

module.exports = {
  AccessApplication,
  NukiAccessApplication,
  SaltoKsAccessApplication,
  IfbsAccessApplication,
  ParevaAccessApplication,
  OpenLockerAccessApplication,
  ACCESS_APP_TYPE,
  accessAppTypes,
  appClassOf,
  createAccessApplication,
  findAccessApp,
  registerAccessAppType,
  secretFieldsOf,
};
