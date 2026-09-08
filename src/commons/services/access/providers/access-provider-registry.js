const providers = {};

function registerAccessProvider(providerName, ProviderClass) {
  providers[providerName] = new ProviderClass();
}

function getAccessProvider(providerName) {
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`No access provider registered for: ${providerName}`);
  }
  return provider;
}

function hasAccessProvider(providerName) {
  return !!providers[providerName];
}

/**
 * What the provider of a lock can do, as declared by its class. Optional
 * capabilities such as `getLocation` are only offered by the providers that
 * really implement them, so a caller can ask before it calls.
 *
 * @param {string} providerName Id of the provider, e.g. `nuki`
 * @returns {string[]} Declared capabilities, empty for unknown providers
 */
function getAccessProviderCapabilities(providerName) {
  return providers[providerName]?.constructor.capabilities || [];
}

module.exports = {
  registerAccessProvider,
  getAccessProvider,
  hasAccessProvider,
  getAccessProviderCapabilities,
};
