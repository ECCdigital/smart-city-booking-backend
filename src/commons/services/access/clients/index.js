const { registerClient } = require("./access-client-registry");
const { registerTestHandler } = require("./access-test-registry");
const {
  NukiApiClient,
  DEFAULT_NUKI_API_BASE_URL,
} = require("./nuki-api-client");
const { SaltoKsApiClient, extractSaltoList } = require("./salto-ks-api-client");
const IfbsApiClient = require("./ifbs-api-client");
const ParevaApiClient = require("./pareva-api-client");
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
  handler: async (
    {
      clientId,
      clientSecret,
      siteId,
      environment,
      apiBaseUrl,
      username,
      password,
    },
    context = {},
  ) => {
    const resolvedEnvironment =
      // `apiBaseUrl` is what an admin UI from before the environment switch
      // sends; it is only read to tell which environment it meant.
      SaltoKsAccessApplication.resolveEnvironment({ environment, apiBaseUrl });

    const base = await SaltoKsApiClient.testConnection(
      clientId,
      clientSecret,
      siteId,
      resolvedEnvironment,
      { username, password },
    );

    if (!base.success || !siteId) {
      return base;
    }

    // §9 of docs/specs/salto-ks-remote-open.md: next to the plain
    // reachability the test shows the system user's `remote_access` and the
    // per-IQ picture. Both are best-effort - a failing overview does not turn
    // a working connection into a failed test. The remote locking right
    // (REMOTE_LOCKING_*) cannot be asked for via the API; the test says so
    // instead of pretending a check it cannot make.
    const client = new SaltoKsApiClient(
      clientId,
      clientSecret,
      siteId,
      resolvedEnvironment,
      { username, password },
    );

    const details = {
      remoteAccess: null,
      remoteLockingRight: "not_verifiable",
      iqs: [],
    };

    try {
      const me = await client.getSiteMe();
      details.remoteAccess = me?.remote_access ?? null;
    } catch {
      details.remoteAccess = null;
    }

    try {
      // Lazy require: the activation service itself requires this module to
      // have the client registered.
      const SaltoKsIqActivationService = require("../salto-ks-iq-activation-service");
      const states = await SaltoKsIqActivationService.getLocalStates(
        context.tenantId,
      );
      const iqs = extractSaltoList(await client.getIqs());
      details.iqs = iqs.map((iq) => ({
        id: String(iq.id),
        customerReference: iq.customer_reference || "",
        otpEnabled: iq.otp_enabled ?? false,
        online: iq.online ?? null,
        restoreRequired: iq.restore_required ?? false,
        state: states[String(iq.id)] || "not_activated",
      }));
    } catch {
      details.iqs = [];
    }

    return { ...base, details };
  },
});

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
