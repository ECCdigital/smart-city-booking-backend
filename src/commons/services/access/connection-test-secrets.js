const TenantManager = require("../../data-managers/tenant-manager");
const { DOMAIN } = require("../authorization/reach");
const {
  accessAppTypes,
  createAccessApplication,
  secretFieldsOf,
} = require("../../entities/application/accessApplication");

const APP_TYPE = "access";

/**
 * The tenant's stored access application of a provider, active or not - an
 * admin may test a configuration before switching it on. The connection
 * test is guarded at its route; the domain reads the tenant.
 *
 * @param {string} providerId
 * @param {string} [tenantId]
 * @returns {Promise<Object|null>}
 */
async function getStoredApp(providerId, tenantId) {
  if (!tenantId) {
    return null;
  }

  const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
  return (
    tenant?.applications?.find(
      (app) => app.type === APP_TYPE && app.id === providerId,
    ) || null
  );
}

function same(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/** `clientId` -> `client_id`, `apiKeyID` -> `api_key_id`. */
function snakeCase(field) {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * The configuration under test with every secret the form left empty taken
 * from the stored application - but only while it still belongs to what the
 * form names: each field of its identity (`secretIdentity`) is the stored
 * one, compared as the application reads them (defaults applied, a Salto KS
 * environment resolved). A secret that cannot be taken is named in
 * `missing` with the reason: `not_stored`, or `<field>_changed` for the
 * first identity field that changed (e.g. `client_id_changed`,
 * `server_url_changed`).
 *
 * `sources` says per secret where the tested value came from.
 *
 * @param {string} providerId
 * @param {Object} config The configuration as the admin form sent it
 * @param {Object|null} stored The stored application of the provider
 * @returns {{
 *   config: Object,
 *   sources: Object<string, "stored"|"form"|"missing">,
 *   missing: {field: string, reason: string}[],
 * }}
 */
function completeSecrets(providerId, config, stored) {
  const identityOf = accessAppTypes[providerId]?.secretIdentity ?? {};
  const asForm = createAccessApplication({ ...config, id: providerId });
  const asStored = stored
    ? createAccessApplication({ ...stored, id: providerId })
    : null;
  const completed = { ...config };
  const sources = {};
  const missing = [];

  for (const field of secretFieldsOf(providerId)) {
    if (config[field]) {
      sources[field] = "form";
      continue;
    }

    const changed = (identityOf[field] || []).find(
      (identity) => !same(asForm[identity], asStored?.[identity]),
    );
    if (!stored?.[field]) {
      sources[field] = "missing";
      missing.push({ field, reason: "not_stored" });
    } else if (changed) {
      sources[field] = "missing";
      missing.push({ field, reason: `${snakeCase(changed)}_changed` });
    } else {
      sources[field] = "stored";
      completed[field] = stored[field];
    }
  }

  return { config: completed, sources, missing };
}

/**
 * What a connection test runs with: the configuration with the stored
 * secrets taken (`completeSecrets`), checked for the required fields. A
 * required field that is missing stops the test before the provider is
 * asked, naming the fields:
 *
 *     { success: false, code: "missing_fields", message,
 *       missing: [{ field }] }
 *
 * So does a required secret that is still missing:
 *
 *     { success: false, code: "missing_secret", message,
 *       missing: [{ field, reason }] }
 *
 * @param {string} providerId
 * @param {Object} config The configuration as the admin form sent it
 * @param {Object|null} stored The stored application of the provider
 * @param {string[]} requiredFields
 * @returns {{refusal: Object}|{config: Object, sources: Object}}
 */
function prepareConnectionTest(providerId, config, stored, requiredFields) {
  const {
    config: completed,
    sources,
    missing,
  } = completeSecrets(providerId, config || {}, stored);

  const missingFields = requiredFields.filter(
    (field) =>
      !completed[field] && !missing.some((secret) => secret.field === field),
  );
  if (missingFields.length > 0) {
    return {
      refusal: {
        success: false,
        code: "missing_fields",
        message: `Missing required fields: ${missingFields.join(", ")}`,
        missing: missingFields.map((field) => ({ field })),
      },
    };
  }

  const missingSecrets = missing.filter((secret) =>
    requiredFields.includes(secret.field),
  );
  if (missingSecrets.length > 0) {
    return {
      refusal: {
        success: false,
        code: "missing_secret",
        message: `Missing secrets: ${missingSecrets.map((m) => m.field).join(", ")}`,
        missing: missingSecrets,
      },
    };
  }

  return { config: completed, sources };
}

module.exports = { getStoredApp, completeSecrets, prepareConnectionTest };
