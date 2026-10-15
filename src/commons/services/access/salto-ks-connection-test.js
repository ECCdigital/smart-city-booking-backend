const TenantManager = require("../../data-managers/tenant-manager");
const { DOMAIN } = require("../authorization/reach");
const {
  SaltoKsApiClient,
  extractSaltoList,
} = require("./clients/salto-ks-api-client");
const {
  SaltoKsAccessApplication,
} = require("../../entities/application/accessApplication");

const APP_TYPE = "access";
const PROVIDER_ID = "salto-ks";

const REQUIRED_FIELDS = ["clientId", "clientSecret", "username", "password"];

/**
 * Which stored secret belongs to which part of the identity: a client secret
 * is issued for a client id in one environment, a password belongs to a
 * system user in one environment. The site plays no part - a new site needs
 * no new secret.
 */
const SECRETS = [
  {
    field: "clientSecret",
    identity: "clientId",
    reason: "client_id_changed",
  },
  { field: "password", identity: "username", reason: "username_changed" },
];

/**
 * The tenant's stored Salto KS application, active or not - an admin may
 * test a configuration before switching it on.
 *
 * @param {string} [tenantId]
 * @returns {Promise<Object|null>}
 */
async function getStoredApp(tenantId) {
  if (!tenantId) {
    return null;
  }

  const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
  return (
    tenant?.applications?.find(
      (app) => app.type === APP_TYPE && app.id === PROVIDER_ID,
    ) || null
  );
}

function same(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/**
 * The configuration under test with every secret the form left empty taken
 * from the stored application - but only while it still belongs to what the
 * form names: the client secret while client id and environment are the
 * stored ones, the password while system user and environment are. A secret
 * that cannot be taken is named in `missing` with the reason.
 *
 * `sources` says per secret where the tested value came from.
 *
 * @param {Object} config The configuration as the admin form sent it
 * @param {Object|null} stored The stored Salto KS application
 * @returns {{
 *   config: Object,
 *   sources: Object<string, "stored"|"form"|"missing">,
 *   missing: {field: string, reason: string}[],
 * }}
 */
function completeSecrets(config, stored) {
  const completed = {
    ...config,
    environment: SaltoKsAccessApplication.resolveEnvironment(config),
  };
  const sources = {};
  const missing = [];
  const sameEnvironment =
    !!stored &&
    SaltoKsAccessApplication.resolveEnvironment(stored) ===
      completed.environment;

  for (const { field, identity, reason } of SECRETS) {
    if (config[field]) {
      sources[field] = "form";
      continue;
    }

    if (!stored?.[field]) {
      sources[field] = "missing";
      missing.push({ field, reason: "not_stored" });
    } else if (!sameEnvironment) {
      sources[field] = "missing";
      missing.push({ field, reason: "environment_changed" });
    } else if (!same(config[identity], stored[identity])) {
      sources[field] = "missing";
      missing.push({ field, reason });
    } else {
      sources[field] = "stored";
      completed[field] = stored[field];
    }
  }

  return { config: completed, sources, missing };
}

/**
 * The best-effort details next to a working connection: the system user's
 * `remote_access` and the activation state per IQ. A failing overview does
 * not turn a working connection into a failed test. The remote locking right
 * cannot be asked for via the API; the test says so instead of pretending a
 * check it cannot make.
 *
 * @param {SaltoKsApiClient} client
 * @param {string} [tenantId]
 */
async function readDetails(client, tenantId) {
  const details = {
    remoteAccess: null,
    remoteLockingRight: "not_verifiable",
    iqs: [],
  };

  try {
    const me = await client.getSiteMe();
    details.remoteAccess = me?.remote_access ?? null;
  } catch {
    details.remoteAccess = null;
  }

  try {
    // Lazy require: the activation service requires the client registry,
    // which registers this test.
    const SaltoKsIqActivationService = require("./salto-ks-iq-activation-service");
    const states = await SaltoKsIqActivationService.getLocalStates(tenantId);
    const iqs = extractSaltoList(await client.getIqs());
    details.iqs = iqs.map((iq) => ({
      id: String(iq.id),
      customerReference: iq.customer_reference || "",
      otpEnabled: iq.otp_enabled ?? false,
      online: iq.online ?? null,
      restoreRequired: iq.restore_required ?? false,
      state: states[String(iq.id)] || "not_activated",
    }));
  } catch {
    details.iqs = [];
  }

  return details;
}

/**
 * The connection test of Salto KS. Secrets the form leaves empty are taken
 * from the stored application (see `completeSecrets`); only then are the
 * required fields checked. A secret that is still missing stops the test
 * before Salto is asked:
 *
 *     { success: false, code: "missing_secret", message,
 *       missing: [{ field: "clientSecret" | "password",
 *                   reason: "client_id_changed" | "username_changed"
 *                         | "environment_changed" | "not_stored" }] }
 *
 * @param {Object} config The configuration as the admin form sent it
 * @param {{tenantId?: string}} [context]
 * @returns {Promise<Object>} `{ success, message, details? }`, or the
 *   answer above
 */
async function testSaltoKsConnection(config, context = {}) {
  const stored = await getStoredApp(context.tenantId);
  const { config: completed, missing } = completeSecrets(config, stored);

  const missingFields = REQUIRED_FIELDS.filter(
    (field) =>
      !completed[field] && !missing.some((secret) => secret.field === field),
  );
  if (missingFields.length > 0) {
    return {
      success: false,
      message: `Missing required fields: ${missingFields.join(", ")}`,
    };
  }

  if (missing.length > 0) {
    return {
      success: false,
      code: "missing_secret",
      message: `Missing secrets: ${missing.map((m) => m.field).join(", ")}`,
      missing,
    };
  }

  const { clientId, clientSecret, siteId, environment, username, password } =
    completed;

  const base = await SaltoKsApiClient.testConnection(
    clientId,
    clientSecret,
    siteId,
    environment,
    { username, password },
  );

  if (!base.success || !siteId) {
    return base;
  }

  const client = new SaltoKsApiClient(
    clientId,
    clientSecret,
    siteId,
    environment,
    { username, password },
  );

  return { ...base, details: await readDetails(client, context.tenantId) };
}

module.exports = { testSaltoKsConnection };
