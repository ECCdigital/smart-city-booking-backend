const { BaseError } = require("./BaseError");

/**
 * Provider-neutral storage failure.
 *
 * Every storage provider normalises its own client errors (webdav, AWS SDK, …)
 * onto this class so callers never have to know which backend is configured.
 */
class StorageError extends BaseError {
  constructor(code = "storage_error", statusCode = 503, params = {}) {
    super(code, statusCode, params);
    this.name = "StorageError";
    this.isStorageError = true;
  }

  /**
   * Normalise an arbitrary provider error onto a StorageError.
   *
   * Every failure but a missing key becomes a 503: the provider's own status
   * says something about the storage backend, not about the API request, and
   * must never surface as e.g. a 401 on an upload. The original status is kept
   * as context for the logs.
   *
   * @param {Error} error - The original provider error.
   * @param {string} code - Stable error code, e.g. `storage_put_failed`.
   * @param {Object} params - Additional context (provider, key, …).
   * @returns {StorageError}
   */
  static from(error, code, params = {}) {
    if (error instanceof StorageError) {
      return error;
    }

    return new StorageError(code, 503, {
      ...params,
      providerStatus:
        error?.status ||
        error?.statusCode ||
        error?.response?.status ||
        error?.$metadata?.httpStatusCode ||
        null,
      message: error?.message,
    });
  }
}

/**
 * Raised when a key does not exist in the configured storage.
 */
class StorageNotFoundError extends StorageError {
  constructor(params = {}) {
    super("storage_object_not_found", 404, params);
    this.name = "StorageNotFoundError";
  }
}

module.exports = { StorageError, StorageNotFoundError };
