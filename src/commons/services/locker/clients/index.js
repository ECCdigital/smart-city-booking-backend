const { registerClient } = require("./locker-client-registry");
const { registerTestHandler } = require("./locker-test-registry");
const IfbsApiClient = require("./ifbs-api-client");
const ParevaApiClient = require("./pareva-api-client");

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
