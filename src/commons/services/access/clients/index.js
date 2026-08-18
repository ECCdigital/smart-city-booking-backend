const { registerClient } = require("./access-client-registry");
const { registerTestHandler } = require("./access-test-registry");
const {
  NukiApiClient,
  DEFAULT_NUKI_API_BASE_URL,
} = require("./nuki-api-client");
const { SaltoKsApiClient } = require("./salto-ks-api-client");
const {
  SaltoKsAccessApplication,
} = require("../../../entities/application/accessApplication");

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

registerTestHandler("salto-ks", {
  requiredFields: ["clientId", "clientSecret", "username", "password"],
  handler: ({
    clientId,
    clientSecret,
    siteId,
    environment,
    apiBaseUrl,
    username,
    password,
  }) => {
    return SaltoKsApiClient.testConnection(
      clientId,
      clientSecret,
      siteId,
      // `apiBaseUrl` is what an admin UI from before the environment switch
      // sends; it is only read to tell which environment it meant.
      SaltoKsAccessApplication.resolveEnvironment({ environment, apiBaseUrl }),
      { username, password },
    );
  },
});
