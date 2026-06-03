const testHandlers = {};

function registerTestHandler(providerId, handler) {
  testHandlers[providerId] = handler;
}

async function testProvider(providerId, config) {
  const handler = testHandlers[providerId];

  if (!handler) {
    throw new Error(`No test handler registered for provider: ${providerId}`);
  }

  if (typeof handler === "function") {
    return handler(config);
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

  return handler.handler(config);
}

function hasTestHandler(providerId) {
  return !!testHandlers[providerId];
}

module.exports = {
  registerTestHandler,
  testProvider,
  hasTestHandler,
};
