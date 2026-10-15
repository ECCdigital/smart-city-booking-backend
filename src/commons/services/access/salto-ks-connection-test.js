const TenantManager = require("../../data-managers/tenant-manager");
const { DOMAIN } = require("../authorization/reach");
const {
  SaltoKsApiClient,
  extractSaltoList,
  describeUpstreamError,
} = require("./clients/salto-ks-api-client");
const BaseAccessApiClient = require("./clients/base-access-api-client");
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

/** Network errors axios raises when Salto does not answer in time. */
const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

const OK = Object.freeze({ status: "ok" });
const SKIPPED = Object.freeze({ status: "skipped" });
const UNKNOWN = Object.freeze({ status: "unknown" });
// Whether the system user may open the doors remotely is a right at the
// locks in Salto KS; the Connect API does not tell. The test says so instead
// of pretending a check it cannot make.
const NOT_VERIFIABLE = Object.freeze({ status: "not_verifiable" });

function failed(code) {
  return code ? { status: "failed", code } : { status: "failed" };
}

function isTimeout(err) {
  return TIMEOUT_CODES.includes(err?.code);
}

/**
 * What a failed token request means. The password grant checks client and
 * system user in one call: the identity server answers `invalid_client` for
 * a client id or client secret it does not know (also one of the other
 * environment), `invalid_grant` for a system user or password it rejects.
 *
 * @param {Error} err
 * @returns {{credentials: Object, login: Object}}
 */
function classifyTokenFailure(err) {
  const oauthError = err?.response?.data?.error;
  if (oauthError === "invalid_grant") {
    return { credentials: OK, login: failed("invalid_grant") };
  }
  if (oauthError === "invalid_client") {
    return { credentials: failed("invalid_client"), login: SKIPPED };
  }
  return {
    credentials: failed(isTimeout(err) ? "timeout" : null),
    login: SKIPPED,
  };
}

/**
 * What a failed read of the site means. Salto answers a site the system user
 * has no role at like a site it does not have; a site reference `/sites`
 * does not list fails before Salto is asked. Both are `site_forbidden`. A
 * server error keeps its message without code.
 *
 * @param {Error} err
 * @returns {Object}
 */
function classifySiteFailure(err) {
  if (isTimeout(err)) {
    return failed("timeout");
  }
  const status = err?.response?.status;
  if (status >= 500 || (!status && err?.code)) {
    return failed(null);
  }
  return failed("site_forbidden");
}

function failureMessage(err) {
  return (
    describeUpstreamError(err) ||
    BaseAccessApiClient.handleConnectionError(err).message
  );
}

/**
 * The best-effort details next to a working connection: the system user's
 * `remote_access` and the activation state per IQ. A failing read leaves its
 * check `unknown` and does not turn a working connection into a failed test.
 *
 * @param {SaltoKsApiClient} client
 * @param {string} [tenantId]
 * @returns {Promise<{details: Object, checks: Object}>}
 */
async function readDetails(client, tenantId) {
  const details = {
    remoteAccess: null,
    remoteLockingRight: "not_verifiable",
    iqs: [],
  };
  const checks = { remoteAccess: UNKNOWN, iqs: UNKNOWN };

  try {
    const me = await client.getSiteMe();
    details.remoteAccess = me?.remote_access ?? null;
  } catch {
    details.remoteAccess = null;
  }
  if (details.remoteAccess === true) {
    checks.remoteAccess = OK;
  } else if (details.remoteAccess === false) {
    checks.remoteAccess = failed("remote_access_off");
  }

  try {
    // Lazy require: the activation service requires the client registry,
    // which registers this test.
    const SaltoKsIqActivationService = require("./salto-ks-iq-activation-service");
    const states = await SaltoKsIqActivationService.getLocalStates(
      tenantId,
      client,
    );
    const iqs = extractSaltoList(await client.getIqs());
    details.iqs = iqs.map((iq) => ({
      id: String(iq.id),
      customerReference: iq.customer_reference || "",
      otpEnabled: iq.otp_enabled ?? false,
      online: iq.online ?? null,
      restoreRequired: iq.restore_required ?? false,
      state: states[String(iq.id)] || "not_activated",
    }));
    checks.iqs = OK;
  } catch {
    details.iqs = [];
  }

  return { details, checks };
}

/**
 * The checks in the order an admin works through them. The first failure in
 * `credentials`, `login` or `site` fails the test and skips the checks after
 * it; `remoteLockingRight` is always `not_verifiable`.
 *
 * @param {SaltoKsApiClient} client
 * @param {string} [siteId]
 * @param {string} [tenantId]
 * @returns {Promise<{success: boolean, message: string, checks: Object,
 *   details?: Object}>}
 */
async function runChecks(client, siteId, tenantId) {
  const checks = {
    credentials: SKIPPED,
    login: SKIPPED,
    site: SKIPPED,
    remoteAccess: SKIPPED,
    remoteLockingRight: NOT_VERIFIABLE,
    iqs: SKIPPED,
  };

  try {
    await client._getToken();
    checks.credentials = OK;
    checks.login = OK;
  } catch (err) {
    Object.assign(checks, classifyTokenFailure(err));
    return { success: false, message: failureMessage(err), checks };
  }

  if (!siteId) {
    checks.site = failed("site_missing");
    return { success: false, message: "Missing site", checks };
  }

  try {
    const locks = extractSaltoList(await client.getLocks(siteId));
    checks.site = { status: "ok", locks: locks.length };
  } catch (err) {
    checks.site = classifySiteFailure(err);
    return { success: false, message: failureMessage(err), checks };
  }

  const read = await readDetails(client, tenantId);
  return {
    success: true,
    message: `Connection successful (${client.environment})`,
    checks: { ...checks, ...read.checks },
    details: read.details,
  };
}

/**
 * The connection test of Salto KS. Secrets the form leaves empty are taken
 * from the stored application (see `completeSecrets`); only then are the
 * required fields checked. A required field that is missing stops the test
 * before Salto is asked, naming the fields as the request does:
 *
 *     { success: false, code: "missing_fields", message,
 *       missing: [{ field: "clientId" | "username" }] }
 *
 * So does a secret that is still missing:
 *
 *     { success: false, code: "missing_secret", message,
 *       missing: [{ field: "clientSecret" | "password",
 *                   reason: "client_id_changed" | "username_changed"
 *                         | "environment_changed" | "not_stored" }] }
 *
 * Otherwise the answer names each check with its status and, for a failure
 * Salto explains, a code instead of Salto's raw message; the texts are the
 * Admin UI's:
 *
 *     { success, message, environment, testedAt,
 *       testedWith: { clientSecret: "stored" | "form",
 *                     password: "stored" | "form" },
 *       checks: { credentials, login, site, remoteAccess,
 *                 remoteLockingRight, iqs:
 *         { status: "ok" | "failed" | "skipped" | "unknown"
 *                 | "not_verifiable", code? } },
 *       details? }
 *
 * `site` carries `locks`, the number of locks of the site. `details` (remote
 * access and the IQs) comes with a working connection.
 *
 * @param {Object} config The configuration as the admin form sent it
 * @param {{tenantId?: string}} [context]
 * @returns {Promise<Object>}
 */
async function testSaltoKsConnection(config, context = {}) {
  const stored = await getStoredApp(context.tenantId);
  const {
    config: completed,
    sources,
    missing,
  } = completeSecrets(config, stored);

  const missingFields = REQUIRED_FIELDS.filter(
    (field) =>
      !completed[field] && !missing.some((secret) => secret.field === field),
  );
  if (missingFields.length > 0) {
    return {
      success: false,
      code: "missing_fields",
      message: `Missing required fields: ${missingFields.join(", ")}`,
      missing: missingFields.map((field) => ({ field })),
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
  const answer = {
    environment,
    testedAt: new Date().toISOString(),
    testedWith: {
      clientSecret: sources.clientSecret,
      password: sources.password,
    },
  };

  const client = new SaltoKsApiClient(
    clientId,
    clientSecret,
    siteId,
    environment,
    { username, password },
  );

  return {
    ...(await runChecks(client, siteId, context.tenantId)),
    ...answer,
  };
}

module.exports = { testSaltoKsConnection };
