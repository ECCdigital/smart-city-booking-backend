const { registerClient } = require("./access-client-registry");
const { registerTestHandler } = require("./access-test-registry");
const {
  NukiApiClient,
  DEFAULT_NUKI_API_BASE_URL,
} = require("./nuki-api-client");
const { SaltoKsApiClient } = require("./salto-ks-api-client");
const IfbsApiClient = require("./ifbs-api-client");
const ParevaApiClient = require("./pareva-api-client");
const {
  SaltoKsAccessApplication,
} = require("../../../entities/application/accessApplication");
const { testSaltoKsConnection } = require("../salto-ks-connection-test");

registerClient("nuki", NukiApiClient, (app) => [
  app.apiToken,
  app.apiBaseUrl || DEFAULT_NUKI_API_BASE_URL,
]);

registerTestHandler("nuki", {
  requiredFields: ["apiToken"],
  handler: ({ apiToken, apiBaseUrl }) => {
    return NukiApiClient.testConnection(
      apiToken,
      apiBaseUrl || DEFAULT_NUKI_API_BASE_URL,
    );
  },
});

registerClient("salto-ks", SaltoKsApiClient, (app) => [
  app.clientId,
  app.clientSecret,
  app.siteId,
  SaltoKsAccessApplication.resolveEnvironment(app),
  { username: app.username, password: app.password },
]);

registerTestHandler("salto-ks", testSaltoKsConnection);

registerClient("ifbs", IfbsApiClient, (app) => [
  app.serverUrl,
  app.apiKey,
  app.secretPhrase,
]);

registerTestHandler("ifbs", {
  requiredFields: ["serverUrl", "apiKey"],
  handler: ({ serverUrl, apiKey }) => {
    return IfbsApiClient.testConnection(serverUrl, apiKey);
  },
});

registerClient("pareva", ParevaApiClient, (app) => [
  app.serverUrl,
  app.lockerId,
  app.user,
  app.password,
]);

registerTestHandler("pareva", {
  requiredFields: ["serverUrl", "lockerId", "user", "password"],
  handler: ({ serverUrl, lockerId, user, password }) => {
    return ParevaApiClient.testConnection(serverUrl, lockerId, user, password);
  },
});
