const {
  createAccessApplication,
} = require("../../../entities/application/accessApplication");

const registry = {};

function registerClient(providerId, ClientClass, extractArgs) {
  registry[providerId] = { ClientClass, extractArgs };
}

function createClient(rawApp) {
  const entry = registry[rawApp.id];
  if (!entry) {
    throw new Error(`No API client registered for provider: ${rawApp.id}`);
  }

  const app =
    typeof rawApp.decrypt === "function"
      ? rawApp
      : createAccessApplication(rawApp);

  if (typeof app.decrypt === "function") {
    app.decrypt();
  }

  const args = entry.extractArgs(app);
  return new entry.ClientClass(...args);
}

function getCapabilities(providerId) {
  const entry = registry[providerId];
  if (!entry) return [];
  return entry.ClientClass.capabilities || [];
}

function getRegisteredProviders() {
  return Object.keys(registry);
}

module.exports = {
  registerClient,
  createClient,
  getCapabilities,
  getRegisteredProviders,
};
