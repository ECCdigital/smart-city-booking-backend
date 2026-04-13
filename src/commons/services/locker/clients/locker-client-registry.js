const {
  createLockerApplication,
} = require("../../../entities/application/lockerApplication");

const registry = {};

/**
 * Registers a locker API client class for a provider.
 * @param {string} providerId - e.g. "ifbs", "pareva"
 * @param {typeof BaseLockerApiClient} ClientClass
 * @param {function} extractArgs - (decryptedApp) => constructorArgs[]
 */
function registerClient(providerId, ClientClass, extractArgs) {
  registry[providerId] = { ClientClass, extractArgs };
}

/**
 * Creates a ready-to-use API client with decrypted credentials.
 * @param {Object} rawApp - Raw application object from tenant
 * @returns {BaseLockerApiClient}
 */
function createClient(rawApp) {
  const entry = registry[rawApp.id];
  if (!entry) {
    throw new Error(`No API client registered for provider: ${rawApp.id}`);
  }

  let app;
  if (typeof rawApp.decrypt === 'function' && typeof rawApp.encrypt === 'function') {
    app = rawApp;
  } else {
    app = createLockerApplication(rawApp);
  }


  const args = entry.extractArgs(app);
  return new entry.ClientClass(...args);
}

/**
 * Returns capabilities for a registered provider.
 * @param {string} providerId
 * @returns {string[]}
 */
function getCapabilities(providerId) {
  const entry = registry[providerId];
  if (!entry) return [];
  return entry.ClientClass.capabilities || [];
}

/**
 * Returns all registered provider IDs.
 * @returns {string[]}
 */
function getRegisteredProviders() {
  return Object.keys(registry);
}

module.exports = {
  registerClient,
  createClient,
  getCapabilities,
  getRegisteredProviders,
};