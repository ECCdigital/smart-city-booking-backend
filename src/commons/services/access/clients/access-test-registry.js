const testHandlers = {};

function registerTestHandler(providerId, handler) {
  testHandlers[providerId] = handler;
}

/**
 * Runs the registered connection test of a provider. A handler object is
 * not called while a required field or a secret is missing; a handler
 * function answers that itself.
 *
 * @param {string} providerId
 * @param {Object} config The configuration under test, as the admin form
 *   sent it - not necessarily what is stored
 * @param {Object} [context] Where the test runs, e.g. `{ tenantId }`, for
 *   handlers that enrich the answer with stored state. `secrets` says per
 *   secret where the tested value comes from (`sources`) and which stored
 *   secret could not be taken (`missing`, `{ field, reason }`), see
 *   `StoredSecretService.completeSecrets`
 */
async function testProvider(providerId, config, context = {}) {
  const handler = testHandlers[providerId];

  if (!handler) {
    throw new Error(`No test handler registered for provider: ${providerId}`);
  }

  if (typeof handler === "function") {
    return handler(config, context);
  }

  const missingSecrets = context.secrets?.missing || [];
  if (handler.requiredFields) {
    const missing = handler.requiredFields.filter(
      (field) =>
        !config[field] &&
        !missingSecrets.some((secret) => secret.field === field),
    );
    if (missing.length > 0) {
      return {
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      };
    }
  }

  if (missingSecrets.length > 0) {
    return missingSecretAnswer(missingSecrets);
  }

  return handler.handler(config, context);
}

/**
 * The answer of a test that stops for a stored secret it cannot take.
 *
 * @param {{field: string, reason: string}[]} missing
 */
function missingSecretAnswer(missing) {
  return {
    success: false,
    code: "missing_secret",
    message: `Missing secrets: ${missing.map((m) => m.field).join(", ")}`,
    missing,
  };
}

function hasTestHandler(providerId) {
  return !!testHandlers[providerId];
}

module.exports = {
  registerTestHandler,
  testProvider,
  hasTestHandler,
  missingSecretAnswer,
};
