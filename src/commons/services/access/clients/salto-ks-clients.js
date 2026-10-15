const crypto = require("crypto");
const clientRegistry = require("./access-client-registry");
const {
  SaltoKsAccessApplication,
  createAccessApplication,
} = require("../../../entities/application/accessApplication");

/**
 * The Salto KS client of each tenant, kept for as long as the tenant's
 * credentials stay the same, so its token is reused while it is valid instead
 * of signing in at the identity server on every call. Shared by the access
 * provider and the IQ activation service.
 *
 * @type {Map<string, {key: string, client: Object}>}
 */
const clients = new Map();

/**
 * Everything the client signs in and reads the site with, as one hash: a
 * change to any of it (a rotated secret, another system user, site or
 * environment) yields another key, and with it a new client and a new token.
 *
 * @param {Object} rawApp The tenant's Salto application
 * @returns {string}
 */
function credentialsKey(rawApp) {
  const app = createAccessApplication({ ...rawApp });
  app.decrypt();

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        app.clientId,
        app.clientSecret,
        app.username,
        app.password,
        app.siteId,
        SaltoKsAccessApplication.resolveEnvironment(app),
      ]),
    )
    .digest("hex");
}

/**
 * The tenant's Salto KS client: the one built before while the credentials
 * are unchanged, otherwise a new one that replaces it - the old token is not
 * used again.
 *
 * @param {string} tenantId
 * @param {Object} app The tenant's active Salto application
 * @returns {Object} A `SaltoKsApiClient`
 */
function saltoKsClientFor(tenantId, app) {
  const key = credentialsKey(app);
  const cached = clients.get(tenantId);
  if (cached?.key === key) {
    return cached.client;
  }

  const client = clientRegistry.createClient(app);
  clients.set(tenantId, { key, client });
  return client;
}

/** Drops every kept client; for tests that swap the client factory. */
function forgetSaltoKsClients() {
  clients.clear();
}

module.exports = { saltoKsClientFor, forgetSaltoKsClients };
