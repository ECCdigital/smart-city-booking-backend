const crypto = require("crypto");
const clientRegistry = require("./access-client-registry");
const {
  createAccessApplication,
} = require("../../../entities/application/accessApplication");

/** Every cache made here, so a stored or removed tenant releases them all. */
const caches = [];

/**
 * The API client of each tenant for one provider, kept for as long as the
 * tenant's credentials stay the same, so its token is reused instead of
 * signing in on every call. A change to any of the credentials yields
 * another key, and with it a new client that signs in afresh - the old
 * token is not used again.
 *
 * @param {string} providerId The provider's id, e.g. `salto-ks`
 * @param {function(Object): Array} credentialsOf What the client signs in
 *   and reads with, from the decrypted application
 * @returns {{clientFor: function(string, Object): Object,
 *   release: function(string, Object=): void, forget: function(): void}}
 */
function createTenantClientCache(providerId, credentialsOf) {
  /** @type {Map<string, {key: string, client: Object}>} */
  const clients = new Map();

  function credentialsKey(rawApp) {
    const app = createAccessApplication({ ...rawApp });
    app.decrypt();

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(credentialsOf(app)))
      .digest("hex");
  }

  const cache = {
    /**
     * The tenant's client: the one built before while the credentials are
     * unchanged, otherwise a new one that replaces it.
     *
     * @param {string} tenantId
     * @param {Object} app The tenant's active application of the provider
     * @returns {Object} The API client
     */
    clientFor(tenantId, app) {
      const key = credentialsKey(app);
      const cached = clients.get(tenantId);
      if (cached?.key === key) {
        return cached.client;
      }

      const client = clientRegistry.createClient(app);
      clients.set(tenantId, { key, client });
      return client;
    },

    /**
     * Drops the tenant's client, and with it the decrypted secrets and the
     * token it holds, unless the tenant has an active application of the
     * provider.
     *
     * @param {string} tenantId
     * @param {Object|null} [tenant] The tenant as stored, `null` when removed
     */
    release(tenantId, tenant = null) {
      const active = (tenant?.applications || []).some(
        (app) =>
          app?.type === "access" && app?.id === providerId && app?.active,
      );
      if (!active) {
        clients.delete(tenantId);
      }
    },

    /** Drops every kept client; for tests that swap the client factory. */
    forget() {
      clients.clear();
    },
  };

  caches.push(cache);
  return cache;
}

/**
 * Releases the tenant's clients of every provider, as of
 * `release`. Called when a tenant is stored (with the tenant) and when it is
 * removed (without).
 *
 * @param {string} tenantId
 * @param {Object|null} [tenant] The tenant as stored, `null` when removed
 */
function releaseTenantClients(tenantId, tenant = null) {
  for (const cache of caches) {
    cache.release(tenantId, tenant);
  }
}

module.exports = { createTenantClientCache, releaseTenantClients };
