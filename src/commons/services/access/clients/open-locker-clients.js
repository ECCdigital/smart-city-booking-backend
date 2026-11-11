const crypto = require("crypto");
const clientRegistry = require("./access-client-registry");
const {
  createAccessApplication,
} = require("../../../entities/application/accessApplication");

const PROVIDER_ID = "open-locker";

/**
 * The Open Locker client of each tenant, kept for as long as the tenant's
 * credentials stay the same, so its token is reused instead of signing in
 * on every open and every poll - Open Locker throttles the login to six
 * attempts a minute.
 *
 * @type {Map<string, {key: string, client: Object}>}
 */
const clients = new Map();

/**
 * Server, account and password as one hash: a change to any of them yields
 * another key, and with it a new client that signs in afresh.
 *
 * @param {Object} rawApp The tenant's Open Locker application
 * @returns {string}
 */
function credentialsKey(rawApp) {
  const app = createAccessApplication({ ...rawApp });
  app.decrypt();

  return crypto
    .createHash("sha256")
    .update(JSON.stringify([app.serverUrl, app.email, app.password]))
    .digest("hex");
}

/**
 * The tenant's Open Locker client: the one built before while the
 * credentials are unchanged, otherwise a new one that replaces it.
 *
 * @param {string} tenantId
 * @param {Object} app The tenant's active Open Locker application
 * @returns {Object} An `OpenLockerApiClient`
 */
function openLockerClientFor(tenantId, app) {
  const key = credentialsKey(app);
  const cached = clients.get(tenantId);
  if (cached?.key === key) {
    return cached.client;
  }

  const client = clientRegistry.createClient(app);
  clients.set(tenantId, { key, client });
  return client;
}

/**
 * Drops the tenant's client, and with it the password and the token it
 * holds, unless the tenant has an active Open Locker application. Called
 * when a tenant is stored (with the tenant) and when it is removed
 * (without).
 *
 * @param {string} tenantId
 * @param {Object|null} [tenant] The tenant as stored, `null` when removed
 */
function releaseOpenLockerClient(tenantId, tenant = null) {
  const active = (tenant?.applications || []).some(
    (app) => app?.type === "access" && app?.id === PROVIDER_ID && app?.active,
  );
  if (!active) {
    clients.delete(tenantId);
  }
}

/** Drops every kept client; for tests that swap the client factory. */
function forgetOpenLockerClients() {
  clients.clear();
}

module.exports = {
  openLockerClientFor,
  releaseOpenLockerClient,
  forgetOpenLockerClients,
};
