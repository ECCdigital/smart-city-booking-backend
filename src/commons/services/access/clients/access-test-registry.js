const testHandlers = {};

function registerTestHandler(providerId, handler) {
  testHandlers[providerId] = handler;
}

/**
 * Runs the registered connection test of a provider.
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

  if (handler.requiredFields) {
    const missing = handler.requiredFields.filter((field) => !config[field]);
    if (missing.length > 0) {
      return {
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      };
    }
  }

  return handler.handler(config, context);
}

function hasTestHandler(providerId) {
  return !!testHandlers[providerId];
}

module.exports = {
  registerTestHandler,
  testProvider,
  hasTestHandler,
};
