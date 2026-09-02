const { registerClient } = require("./locker-client-registry");
const { registerTestHandler } = require("./locker-test-registry");
const IfbsApiClient = require("../../access/clients/ifbs-api-client");
const ParevaApiClient = require("../../access/clients/pareva-api-client");

/**
 * Registers the locker API clients. Runs on load; tests that replace a
 * client in the registry call it again to put the real one back.
 */
function registerLockerClients() {
  registerClient("ifbs", IfbsApiClient, (app) => [
    app.serverUrl,
    app.apiKey,
    app.secretPhrase,
  ]);

  registerClient("pareva", ParevaApiClient, (app) => [
    app.serverUrl,
    app.lockerId,
    app.user,
    app.password,
  ]);
}

registerLockerClients();

registerTestHandler("ifbs", {
  requiredFields: ["serverUrl", "apiKey"],
  handler: ({ serverUrl, apiKey }) => {
    return IfbsApiClient.testConnection(serverUrl, apiKey);
  },
});

registerTestHandler("pareva", {
  requiredFields: ["serverUrl", "lockerId", "user", "password"],
  handler: ({ serverUrl, lockerId, user, password }) => {
    return ParevaApiClient.testConnection(serverUrl, lockerId, user, password);
  },
});

module.exports = { registerLockerClients };
