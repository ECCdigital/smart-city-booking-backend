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

module.exports = {
  registerAccessProvider,
  getAccessProvider,
  hasAccessProvider,
};