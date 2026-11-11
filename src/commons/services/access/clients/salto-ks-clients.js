const { createTenantClientCache } = require("./tenant-client-cache");
const {
  SaltoKsAccessApplication,
} = require("../../../entities/application/accessApplication");

/**
 * The Salto KS client of each tenant, kept for as long as the tenant's
 * credentials stay the same, so its token is reused while it is valid instead
 * of signing in at the identity server on every call. Shared by the access
 * provider and the IQ activation service. A rotated secret, another system
 * user, site or environment yields a new client and a new token.
 */
const clients = createTenantClientCache("salto-ks", (app) => [
  app.clientId,
  app.clientSecret,
  app.username,
  app.password,
  app.siteId,
  SaltoKsAccessApplication.resolveEnvironment(app),
]);

module.exports = {
  /**
   * The tenant's Salto KS client.
   *
   * @param {string} tenantId
   * @param {Object} app The tenant's active Salto application
   * @returns {Object} A `SaltoKsApiClient`
   */
  saltoKsClientFor: clients.clientFor,
  /** Drops the tenant's client unless it has an active Salto application. */
  releaseSaltoKsClient: clients.release,
  /** Drops every kept client; for tests that swap the client factory. */
  forgetSaltoKsClients: clients.forget,
};
