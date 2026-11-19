/**
 * The secrets of a tenant or the instance are write only: an answer names
 * that one is stored, never which. Where a secret is stored the answer
 * carries {@link STORED_SECRET} instead, and a write that hands the marker
 * back keeps the stored value. An empty value removes it, any other value
 * replaces it.
 *
 * A stored secret belongs to the fields it is bound to: the server it is
 * sent to and the account it was issued for. The marker stands for it only
 * while those are the stored ones; with another server or account the secret
 * has to be typed again, so a changed address never gets the stored secret.
 *
 * The models decrypt on every read, since the backend itself needs the
 * secrets (mail, payment, access); the marker is put in on the way out only.
 */
const ApplicationFactory = require("../entities/application/applicationFactory");
const { BadRequestError } = require("../../errors/BaseError");

/** Stands in for a stored secret in every answer. */
const STORED_SECRET = "__stored_secret__";

/**
 * The secrets on the tenant and the instance themselves, each with the
 * fields it is bound to. An application names its own (`secrets` of its
 * class).
 */
const OWN_SECRETS = Object.freeze({
  noreplyPassword: ["noreplyHost", "noreplyUser"],
  noreplyGraphClientSecret: ["noreplyGraphTenantId", "noreplyGraphClientId"],
});

/** The application as its class reads it, so defaults compare as stored. */
function asClass(app) {
  const AppClass = ApplicationFactory.classOf(app);
  return AppClass ? new AppClass(app) : app;
}

function secretsOf(app) {
  return ApplicationFactory.classOf(app)?.secrets || {};
}

/**
 * Exact, as the consumers read a field: the class has normalised it already
 * (a Keycloak URL without trailing slash, a Salto KS environment). Only an
 * absent value and an empty one are the same.
 */
function same(a, b) {
  return String(a ?? "") === String(b ?? "");
}

/** `noreplyHost` → `noreply_host_changed`, `apiKeyID` → `api_key_id_changed`. */
function changedReason(field) {
  const snake = field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  return `${snake}_changed`;
}

function masked(object, fields) {
  const copy = { ...object };
  for (const field of fields) {
    copy[field] = copy[field] ? STORED_SECRET : "";
  }
  return copy;
}

/**
 * Puts the stored secret in for each marker in `target` while the fields it
 * is bound to are the stored ones. A secret that cannot be taken is named in
 * `missing` with the reason, its marker stays.
 *
 * @param {Object} target The object the markers are in, mutated
 * @param {Object} next `target` as its class reads it
 * @param {Object|null} stored The stored counterpart, decrypted
 * @param {Object<string, string[]>} secrets
 * @returns {{
 *   sources: Object<string, "stored"|"form"|"missing">,
 *   missing: {field: string, reason: string}[],
 * }}
 */
function resolve(target, next, stored, secrets) {
  const sources = {};
  const missing = [];
  for (const [field, boundTo] of Object.entries(secrets)) {
    if (target[field] !== STORED_SECRET) {
      sources[field] = "form";
      continue;
    }

    const changed = boundTo.find(
      (bound) => !same(next[bound], stored?.[bound]),
    );
    if (!stored?.[field]) {
      missing.push({ field, reason: "not_stored" });
    } else if (changed) {
      missing.push({ field, reason: changedReason(changed) });
    } else {
      sources[field] = "stored";
      target[field] = stored[field];
      continue;
    }
    sources[field] = "missing";
  }
  return { sources, missing };
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

    const result = masked(exported, Object.keys(OWN_SECRETS));
    if (Array.isArray(result.applications)) {
      result.applications = result.applications.map((app) =>
        app ? masked(app, Object.keys(secretsOf(app))) : app,
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
   * @throws {BadRequestError} `secret_required` when a marker comes with
   *   another server or account than the stored secret's;
   *   `params.missing` names each `{ type?, id?, field, reason }`
   */
  static restore(previous, next) {
    if (!next) return next;

    const refused = [];
    const keepOrRefuse = (target, missing, app) => {
      for (const { field, reason } of missing) {
        if (reason === "not_stored") {
          target[field] = null;
        } else {
          refused.push(
            app
              ? { type: app.type, id: app.id, field, reason }
              : { field, reason },
          );
        }
      }
    };

    keepOrRefuse(next, resolve(next, next, previous, OWN_SECRETS).missing);
    for (const app of Array.isArray(next.applications)
      ? next.applications
      : []) {
      if (!app) continue;
      const stored = (previous?.applications || []).find((candidate) =>
        sameApp(candidate, app),
      );
      const { missing } = resolve(
        app,
        asClass(app),
        stored ? asClass(stored) : null,
        secretsOf(app),
      );
      keepOrRefuse(app, missing, app);
    }

    if (refused.length > 0) {
      throw new BadRequestError("secret_required", { missing: refused });
    }
    return next;
  }

  /**
   * Marks the tenant's or instance's own secrets the body leaves out as kept:
   * an update only writes the fields the body names, so a secret left out
   * would stay as stored even next to a new server. Marked, `restore` keeps
   * it under the rule of the marker.
   *
   * @param {Object} next The tenant or instance about to be stored, mutated
   * @param {Object} body The body of the update
   * @returns {Object} `next`
   */
  static markOmitted(next, body) {
    for (const field of Object.keys(OWN_SECRETS)) {
      if (
        !Object.prototype.hasOwnProperty.call(body || {}, field) &&
        next[field]
      ) {
        next[field] = STORED_SECRET;
      }
    }
    return next;
  }

  /**
   * The configuration of an access connection test with each marker
   * resolved by the same rule as a save: the stored secret while the fields
   * it is bound to are the stored ones. A secret that cannot be taken is
   * named in `missing`; `sources` says per secret where the tested value
   * comes from.
   *
   * @param {string} providerId
   * @param {Object} config The configuration as the admin form sent it
   * @param {Object|null} stored The tenant's stored application of the provider
   * @returns {{
   *   config: Object,
   *   sources: Object<string, "stored"|"form"|"missing">,
   *   missing: {field: string, reason: string}[],
   * }} `config` is a copy
   */
  static completeSecrets(providerId, config, stored) {
    const app = { ...config, type: "access", id: providerId };
    const completed = { ...config };
    const { sources, missing } = resolve(
      completed,
      asClass(app),
      stored ? asClass(stored) : null,
      secretsOf(app),
    );
    return { config: completed, sources, missing };
  }
}

module.exports = StoredSecretService;
module.exports.STORED_SECRET = STORED_SECRET;
