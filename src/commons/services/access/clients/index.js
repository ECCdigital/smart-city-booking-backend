const { registerClient } = require("./access-client-registry");
const { registerTestHandler } = require("./access-test-registry");
const {
  NukiApiClient,
  DEFAULT_NUKI_API_BASE_URL,
} = require("./nuki-api-client");

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
