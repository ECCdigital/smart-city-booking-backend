const {
  appClassOf,
  createAccessApplication,
  secretFieldsOf,
} = require("../../entities/application/accessApplication");

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
  const identityOf = appClassOf(providerId).secretIdentity ?? {};
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
 * secrets taken, checked for the required fields. A required field that is
 * missing stops the test before the provider is asked, naming the fields:
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
 * @param {ReturnType<typeof completeSecrets>|undefined} secrets The
 *   configuration completed with the stored secrets (`completeSecrets`), as
 *   the caller that read the stored application made it; without, no
 *   stored secret is taken
 * @param {string[]} requiredFields
 * @returns {{refusal: Object}|{config: Object, sources: Object}}
 */
function prepareConnectionTest(providerId, config, secrets, requiredFields) {
  const {
    config: completed,
    sources,
    missing,
  } = secrets ?? completeSecrets(providerId, config || {}, null);

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

module.exports = { completeSecrets, prepareConnectionTest };
