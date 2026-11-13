const testHandlers = {};

function registerTestHandler(providerId, handler) {
  testHandlers[providerId] = handler;
}

/**
 * Runs the registered connection test of a provider. A handler given as an
 * object (`{ requiredFields, handler }`) gets the configuration with the
 * stored secrets the form left empty taken and its required fields checked
 * (`prepareConnectionTest`); a handler given as a function does that
 * itself.
 *
 * @param {string} providerId
 * @param {Object} config The configuration under test, as the admin form
 *   sent it - not necessarily what is stored
 * @param {Object} [context] Where the test runs, e.g. `{ tenantId }`, for
 *   handlers that enrich the answer with stored state
 */
async function testProvider(providerId, config, context = {}) {
  const handler = testHandlers[providerId];

  if (!handler) {
    throw new Error(`No test handler registered for provider: ${providerId}`);
  }

  if (typeof handler === "function") {
    return handler(config, context);
  }

  // Lazy require: the stored secrets are read off the tenant, whose
  // manager reaches the client registries.
  const {
    getStoredApp,
    prepareConnectionTest,
  } = require("../connection-test-secrets");
  const prepared = prepareConnectionTest(
    providerId,
    config,
    await getStoredApp(providerId, context.tenantId),
    handler.requiredFields || [],
  );
  if (prepared.refusal) {
    return prepared.refusal;
  }

  return handler.handler(prepared.config, context);
}

function hasTestHandler(providerId) {
  return !!testHandlers[providerId];
}

module.exports = {
  registerTestHandler,
  testProvider,
  hasTestHandler,
};
