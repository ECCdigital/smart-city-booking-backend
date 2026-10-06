const bunyan = require("bunyan");

const { STORAGE_PROVIDER } = require("../../schemas/mediaSchema");
const { NextcloudStorageProvider } = require("./nextcloud-storage-provider");
const { S3StorageProvider } = require("./s3-storage-provider");

const logger = bunyan.createLogger({
  name: "storage/index.js",
  level: process.env.LOG_LEVEL,
});

const DEFAULT_PROVIDER = STORAGE_PROVIDER.NEXTCLOUD;

const REQUIRED_ENV = {
  [STORAGE_PROVIDER.NEXTCLOUD]: [
    "NEXTCLOUD_URL",
    "NEXTCLOUD_USERNAME",
    "NEXTCLOUD_PASSWORD",
  ],
  [STORAGE_PROVIDER.S3]: ["S3_BUCKET", "S3_REGION"],
};

const FACTORIES = {
  [STORAGE_PROVIDER.NEXTCLOUD]: () => new NextcloudStorageProvider(),
  [STORAGE_PROVIDER.S3]: () => new S3StorageProvider(),
};

const instances = new Map();

/**
 * The provider new uploads go to. Reading always follows the storage location
 * stored on the medium, never this value.
 *
 * @returns {string} `nextcloud` or `s3`
 */
function configuredProviderName() {
  return process.env.STORAGE_PROVIDER || DEFAULT_PROVIDER;
}

/**
 * Collects the environment variables the given provider is missing.
 *
 * @param {string} providerName - Provider to inspect.
 * @returns {string[]} Names of the missing variables.
 */
function missingEnvFor(providerName) {
  const missing = (REQUIRED_ENV[providerName] || []).filter(
    (name) => !process.env[name],
  );

  if (providerName === STORAGE_PROVIDER.S3) {
    // Static credentials are optional (IAM roles work too) but only as a pair.
    const hasId = Boolean(process.env.S3_ACCESS_KEY_ID);
    const hasSecret = Boolean(process.env.S3_SECRET_ACCESS_KEY);
    if (hasId !== hasSecret) {
      missing.push(hasId ? "S3_SECRET_ACCESS_KEY" : "S3_ACCESS_KEY_ID");
    }
  }

  return missing;
}

/**
 * Fails the boot when the explicitly chosen storage provider is misconfigured.
 * An unset `STORAGE_PROVIDER` keeps the legacy Nextcloud default and only
 * warns, so installations that never touch files still boot.
 *
 * @throws {Error} When `STORAGE_PROVIDER` is set but incomplete or unknown.
 */
function assertStorageConfig() {
  const explicit = Boolean(process.env.STORAGE_PROVIDER);
  const providerName = configuredProviderName();

  if (!FACTORIES[providerName]) {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${providerName}". Expected one of: ${Object.keys(
        FACTORIES,
      ).join(", ")}`,
    );
  }

  const missing = missingEnvFor(providerName);
  if (missing.length === 0) {
    return;
  }

  const message = `Storage provider "${providerName}" is missing configuration: ${missing.join(
    ", ",
  )}`;

  if (explicit) {
    throw new Error(message);
  }

  logger.warn(`${message}. Media uploads will fail until it is configured.`);
}

/**
 * Returns the memoised provider instance for a provider name.
 *
 * @param {string} [providerName] - Defaults to the configured provider.
 * @returns {import("./storage-provider").StorageProvider}
 */
function getStorageProvider(providerName = configuredProviderName()) {
  const factory = FACTORIES[providerName];

  if (!factory) {
    throw new Error(`Unknown storage provider "${providerName}"`);
  }

  if (!instances.has(providerName)) {
    instances.set(providerName, factory());
  }

  return instances.get(providerName);
}

/**
 * Drops the memoised provider instances (used by tests).
 */
function resetStorageProviders() {
  instances.clear();
}

module.exports = {
  assertStorageConfig,
  configuredProviderName,
  getStorageProvider,
  resetStorageProviders,
};
