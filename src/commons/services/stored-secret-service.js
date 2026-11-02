/**
 * The secrets of a tenant or the instance are write only: an answer names
 * that one is stored, never which. Where a secret is stored the answer
 * carries {@link STORED_SECRET} instead, and a write that hands the marker
 * back keeps the stored value. An empty value removes it, any other value
 * replaces it.
 *
 * The models decrypt on every read, since the backend itself needs the
 * secrets (mail, payment, access); the marker is put in on the way out only.
 */

/** Stands in for a stored secret in every answer. */
const STORED_SECRET = "__stored_secret__";

/** The secrets on the tenant and the instance themselves. */
const OWN_FIELDS = Object.freeze([
  "noreplyPassword",
  "noreplyGraphClientSecret",
]);

/** The secrets of an application, by type and, where it varies, by id. */
const APP_FIELDS = Object.freeze({
  auth: ["privateClientSecret"],
  "card-auth": ["apiToken"],
  payment: {
    pmPayment: ["paymentSecret"],
    giroCockpit: ["paymentSecret"],
    ePayBL: ["certPassphrase", "notificationSecret", "clientP12"],
  },
  access: {
    nuki: ["apiToken"],
    "salto-ks": ["clientSecret", "password"],
    ifbs: ["apiKey", "secretPhrase"],
    pareva: ["password"],
  },
});

/**
 * Access providers whose connection test fills an empty secret from the
 * stored application itself, under its own rules: the marker becomes empty
 * for them.
 */
const TESTS_COMPLETING_SECRETS = Object.freeze(["salto-ks"]);

function appFields(app) {
  const fields = APP_FIELDS[app?.type];
  if (Array.isArray(fields)) return fields;
  return fields?.[app?.id] || [];
}

function masked(object, fields) {
  const copy = { ...object };
  for (const field of fields) {
    if (copy[field]) copy[field] = STORED_SECRET;
  }
  return copy;
}

function restored(object, stored, fields) {
  for (const field of fields) {
    if (object[field] === STORED_SECRET) {
      object[field] = stored?.[field] || null;
    }
  }
  return object;
}

function sameApp(a, b) {
  return a?.type === b?.type && a?.id === b?.id;
}

class StoredSecretService {
  /**
   * A tenant or instance answer with every stored secret replaced by the
   * marker. The applications are copied, so the entity behind the answer
   * keeps its values.
   *
   * @param {Object|null} exported The tenant or instance about to be sent
   * @returns {Object|null} A copy with the secrets masked
   */
  static mask(exported) {
    if (!exported) return exported;

    const result = masked(exported, OWN_FIELDS);
    if (Array.isArray(result.applications)) {
      result.applications = result.applications.map((app) =>
        app ? masked(app, appFields(app)) : app,
      );
    }
    return result;
  }

  /**
   * Puts the stored secrets back where a write handed in the marker: the
   * tenant's or instance's own, and each application's from the stored
   * application of the same type and id. A marker without a stored value is
   * none.
   *
   * @param {Object|null} previous The stored tenant or instance, decrypted
   * @param {Object} next The tenant or instance about to be stored, mutated
   * @returns {Object} `next`
   */
  static restore(previous, next) {
    if (!next) return next;

    restored(next, previous, OWN_FIELDS);
    for (const app of Array.isArray(next.applications)
      ? next.applications
      : []) {
      if (!app) continue;
      const stored = (previous?.applications || []).find((candidate) =>
        sameApp(candidate, app),
      );
      restored(app, stored, appFields(app));
    }
    return next;
  }

  /**
   * The configuration of an access connection test with the marker resolved:
   * the stored secret, or empty for a provider whose test completes secrets
   * itself.
   *
   * @param {string} providerId
   * @param {Object} config The configuration as the admin form sent it
   * @param {Object|null} stored The tenant's stored application of the provider
   * @returns {Object} A copy of `config`
   */
  static completeTestConfig(providerId, config, stored) {
    const fields = appFields({ type: "access", id: providerId });
    const completed = { ...config };
    if (TESTS_COMPLETING_SECRETS.includes(providerId)) {
      for (const field of fields) {
        if (completed[field] === STORED_SECRET) completed[field] = "";
      }
      return completed;
    }
    return restored(completed, stored, fields);
  }
}

module.exports = StoredSecretService;
module.exports.STORED_SECRET = STORED_SECRET;
