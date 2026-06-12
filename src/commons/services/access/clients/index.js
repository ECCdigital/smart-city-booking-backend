const { registerClient } = require("./access-client-registry");
const { registerTestHandler } = require("./access-test-registry");
const {
  NukiApiClient,
  DEFAULT_NUKI_API_BASE_URL,
} = require("./nuki-api-client");
const {
  SaltoKsApiClient,
  DEFAULT_SALTO_API_BASE_URL,
} = require("./salto-ks-api-client");

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
  app.apiBaseUrl || DEFAULT_SALTO_API_BASE_URL,
]);

registerTestHandler("salto-ks", {
  requiredFields: ["clientId", "clientSecret"],
  handler: ({ clientId, clientSecret, siteId, apiBaseUrl }) => {
    return SaltoKsApiClient.testConnection(
      clientId,
      clientSecret,
      siteId,
      apiBaseUrl || DEFAULT_SALTO_API_BASE_URL,
    );
  },
});
