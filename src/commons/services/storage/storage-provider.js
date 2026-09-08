const bunyan = require("bunyan");

const {
  StorageError,
  StorageNotFoundError,
} = require("../../../errors/StorageError");

const logger = bunyan.createLogger({
  name: "storage-provider.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * The storage provider contract — exactly seven operations, deliberately no
 * `list`: usage proof runs over the database, cleanup over the media CLI.
 *
 * Every implementation normalises client failures onto `StorageError`
 * (`StorageNotFoundError` for missing keys) so callers stay provider-agnostic.
 * Implementations only tell the base class how their client reports a missing
 * key, see {@link StorageProvider#_isMissing}.
 *
 * @abstract
 */
class StorageProvider {
  /**
   * Stable provider name, stored on every medium (`storage.provider`).
   *
   * @returns {string} `nextcloud` or `s3`
   */
  get name() {
    throw new Error("Not implemented");
  }

  /**
   * Whether a client error means "there is no such key".
   *
   * @param {Error} error - The client error.
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  _isMissing(error) {
    return false;
  }

  /**
   * Maps a client failure onto the provider-neutral storage errors.
   *
   * @param {Error} error - The client error.
   * @param {string} code - Stable error code.
   * @param {string} key - The key that was accessed.
   * @returns {StorageError}
   */
  _toStorageError(error, code, key) {
    if (this._isMissing(error)) {
      return new StorageNotFoundError({ provider: this.name, key });
    }

    logger.error({ err: error, key }, `${this.name} storage failure: ${code}`);
    return StorageError.from(error, code, { provider: this.name, key });
  }

  /**
   * Rethrows a failure unless it only means the key was already gone —
   * removing a missing key is not an error.
   *
   * @param {Error} error - The client error.
   * @param {string} code - Stable error code.
   * @param {string} key - The key that was accessed.
   * @throws {StorageError}
   */
  _throwUnlessMissing(error, code, key) {
    const storageError = this._toStorageError(error, code, key);

    if (storageError instanceof StorageNotFoundError) {
      return;
    }

    throw storageError;
  }

  /**
   * Store bytes under a key, overwriting whatever was there.
   *
   * @param {Object} params
   * @param {string} params.key - Target key.
   * @param {Buffer} params.data - Bytes to store.
   * @param {string} [params.contentType] - MIME type of the bytes.
   * @returns {Promise<{ key: string, size: number }>}
   */
  // eslint-disable-next-line no-unused-vars
  async put({ key, data, contentType }) {
    throw new Error("Not implemented");
  }

  /**
   * Open a readable stream for a key.
   *
   * @param {Object} params
   * @param {string} params.key - Key to read.
   * @returns {Promise<import("node:stream").Readable>}
   */
  // eslint-disable-next-line no-unused-vars
  async getStream({ key }) {
    throw new Error("Not implemented");
  }

  /**
   * Read the full contents of a key.
   *
   * @param {Object} params
   * @param {string} params.key - Key to read.
   * @returns {Promise<Buffer>}
   */
  // eslint-disable-next-line no-unused-vars
  async getBuffer({ key }) {
    throw new Error("Not implemented");
  }

  /**
   * Metadata of a key.
   *
   * @param {Object} params
   * @param {string} params.key - Key to inspect.
   * @returns {Promise<{ size: number, mime: string, etag: string, lastmod: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async stat({ key }) {
    throw new Error("Not implemented");
  }

  /**
   * Remove a single key. Removing a missing key is not an error.
   *
   * @param {Object} params
   * @param {string} params.key - Key to remove.
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async delete({ key }) {
    throw new Error("Not implemented");
  }

  /**
   * Remove several keys. Removing missing keys is not an error.
   *
   * @param {Object} params
   * @param {string[]} params.keys - Keys to remove.
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deleteMany({ keys }) {
    throw new Error("Not implemented");
  }

  /**
   * Remove every key under a prefix — and, on backends with real directories,
   * the directory itself, so no empty folder stays behind. Removing a missing
   * prefix is not an error.
   *
   * @param {Object} params
   * @param {string} params.prefix - Prefix to remove, without trailing slash.
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deletePrefix({ prefix }) {
    throw new Error("Not implemented");
  }
}

module.exports = { StorageProvider };
