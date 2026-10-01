/**
 * „Realm prüfen“ (ECCdigital/tickets#80, #97): checks the stored Keycloak
 * realm from outside, without the Admin API, and answers one row per
 * requirement of the setup guide in the Admin UI's tab „Single Sign-On“.
 * The rows, reasons and details are the contract of
 * `POST /api/instances/keycloak/check`; nothing is stored.
 *
 * When Biletado adds a requirement on the realm, see smart-city-booking-vue-app
 * docs/agents/keycloak-realm.md (the list of places that have to follow).
 *
 * How it runs: the instance is read fresh (never the token check's cache),
 * also while Keycloak is not active, into a context. Row 1 (the realm) runs
 * first and gates the rest: only when it is `ok` do the steps of `STEPS`
 * run, one after another, in the contract's evaluation order; otherwise
 * every row of every step is `na` with `realm_unavailable`. The steps share
 * one `CheckResults`: each writes its rows there and reads what the steps
 * before it found.
 */

const InstanceManager = require("../../data-managers/instance-manager");
const { BadRequestError } = require("../../../errors/BaseError");
const { parseCheckRequest } = require("./check-request");
const { CheckResults } = require("./check-results");
const realmRow = require("./rows/realm-row");
const { STATUS, GENERIC_REASONS, finding } = require("./findings");

/**
 * A step of the check: a probe or a few, and the rows (or parts of rows)
 * they answer. Modules under `rows/` export one step or several.
 *
 * @typedef {Object} CheckStep
 * @property {function(Object): number[]} rowIds The ids of the rows the
 *   step answers for a context (`[]` when it does not apply: row 6 outside
 *   `direct` mode, row 9 without an active role mapping)
 * @property {function(Object, CheckResults): Promise<void>} evaluate Probes
 *   and writes its rows into the results (`results.set(id, finding)`, or
 *   `results.addParts(id, parts)` for a row of parts), reading what earlier
 *   steps found (`results.get(4)`, `results.part(2, "token")`); may probe
 *   concurrently within the step
 */

/**
 * The steps after the realm, in the contract's evaluation order (1, token
 * part of 2, 4, authorize part of 2 and 3, 5, 6, 7, 8 and 9, 10). A step
 * is one line in its slot, `require("./rows/<file>")` or one of several
 * steps a module exports; a step stands after every step whose rows it
 * reads.
 *
 * @type {CheckStep[]}
 */
const STEPS = [
  // Row 2, `token` part (#99): the web client exists and is public.
  // Row 4 (#98): redirect URIs.
  // Row 2, `authorize` part, and row 3 (#99): with the first URI row 4
  // accepted.
  // Row 5 (#98): post logout redirect URIs.
  // Row 6 (#98): web origins, `direct` mode only.
  // Row 7 (#100): API client.
  require("./rows/api-client-row"),
  // Rows 8 and 9 (#100): audience, client roles.
  require("./rows/audience-row"),
  require("./rows/client-roles-row"),
  // Row 10 (#101): Portal-URL.
  require("./rows/portal-row"),
];

/** The stored values no probe can do without, in the order of the form. */
const REQUIRED_SETTINGS = Object.freeze([
  "serverUrl",
  "realm",
  "publicClient",
  "privateClient",
  "privateClientSecret",
]);

class KeycloakCheckService {
  /**
   * Checks the stored realm.
   *
   * @param {Object} body The request body, `{ mode, apps }`
   * @param {Object} [caller] Who asks
   * @param {?string} [caller.authType] `keycloak` or `local`
   * @param {?string} [caller.accessToken] The bearer token of the request
   * @returns {Promise<{checkedAt: string, rows: Object[]}>} The rows by id
   * @throws {ValidationError} When the body breaks the contract
   * @throws {BadRequestError} `keycloak_settings_missing` with
   *   `params.missing` when a stored value is empty
   */
  static async check(body, { authType = null, accessToken = null } = {}) {
    const request = parseCheckRequest(body);
    const checkedAt = new Date().toISOString();
    const instance = await InstanceManager.getInstance();
    const context = KeycloakCheckService._contextOf(instance, request, {
      authType,
      accessToken,
    });

    const results = new CheckResults();
    await realmRow.evaluate(context, results);
    const realmAvailable = results.get(1).status === STATUS.OK;

    for (const step of STEPS) {
      if (realmAvailable) {
        await step.evaluate(context, results);
      } else {
        for (const id of step.rowIds(context)) {
          results.set(
            id,
            finding(STATUS.NA, GENERIC_REASONS.REALM_UNAVAILABLE),
          );
        }
      }
    }

    return { checkedAt, rows: results.rows() };
  }

  /**
   * What every row reads: the stored values of the Keycloak application and
   * the instance, and the request.
   *
   * @param {Object} instance The instance, read fresh
   * @param {Object} request The request body
   * @param {Object} caller `{ authType, accessToken }`
   * @returns {Object} The context
   * @throws {BadRequestError} When a stored value is empty
   */
  static _contextOf(instance, request, { authType, accessToken }) {
    const app =
      (instance?.applications || []).find(
        (application) => application.id === "keycloak",
      ) || {};
    const missing = REQUIRED_SETTINGS.filter((setting) => !app[setting]);
    if (missing.length > 0) {
      throw new BadRequestError("keycloak_settings_missing", { missing });
    }

    const issuer = `${app.serverUrl}/realms/${app.realm}`;

    return {
      serverUrl: app.serverUrl,
      realm: app.realm,
      issuer,
      oidcBase: `${issuer}/protocol/openid-connect`,
      publicClient: app.publicClient,
      privateClient: app.privateClient,
      privateClientSecret: app.privateClientSecret,
      roleMappingActive: Boolean(app.roleMapping?.active),
      portalUrl: instance.portalUrl || instance.catalogUrl || null,
      mode: request.mode,
      apps: request.apps,
      authType,
      accessToken,
    };
  }
}

module.exports = KeycloakCheckService;
