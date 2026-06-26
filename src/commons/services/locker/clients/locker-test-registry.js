const testHandlers = {};

/**
 * Registers a test handler for a provider.
 * @param {string} providerId
 * @param {Object|function} handler - Either (config) => Promise<{success, message}>
 *                                     or {requiredFields: string[], handler: function}
 */
function registerTestHandler(providerId, handler) {
  testHandlers[providerId] = handler;
}

/**
 * Runs the test for a provider.
 * @param {string} providerId
 * @param {Object} config - Raw credentials from the request body
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testProvider(providerId, config) {
  const handler = testHandlers[providerId];

  if (!handler) {
    throw new Error(
      `No test handler registered for provider: ${providerId}`,
    );
  }

  // Support both function and object format
  if (typeof handler === 'function') {
    return handler(config);
  }

  if (handler.requiredFields) {
    const missing = handler.requiredFields.filter(
      (field) => !config[field],
    );
    if (missing.length > 0) {
      return {
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      };
    }
  }

  return handler.handler(config);
}

function hasTestHandler(providerId) {
  return !!testHandlers[providerId];
}

module.exports = { registerTestHandler, testProvider, hasTestHandler };