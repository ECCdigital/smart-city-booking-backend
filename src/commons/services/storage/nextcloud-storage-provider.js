const { posix } = require("node:path");

const { StorageProvider } = require("./storage-provider");

const WEBDAV_TIMEOUT = 30000;
const MAX_BODY_LENGTH = 100 * 1024 * 1024;

/**
 * Creates the WebDAV client from the Nextcloud environment configuration.
 *
 * @returns {Object} A webdav client.
 */
function createWebdavClient() {
  const { createClient } = require("webdav");

  return createClient(`${process.env.NEXTCLOUD_URL}/remote.php/webdav`, {
    username: process.env.NEXTCLOUD_USERNAME,
    password: process.env.NEXTCLOUD_PASSWORD,
    timeout: WEBDAV_TIMEOUT,
    maxBodyLength: MAX_BODY_LENGTH,
    maxContentLength: MAX_BODY_LENGTH,
  });
}

/**
 * Nextcloud (WebDAV) implementation of the storage provider contract.
 *
 * Independent of the legacy `NextcloudManager`, which keeps serving the
 * pre-media file tree until the migration ticket retires it.
 */
class NextcloudStorageProvider extends StorageProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] - Pre-built webdav client (used by tests).
   */
  constructor({ client } = {}) {
    super();
    this._client = client || null;
  }

  get name() {
    return "nextcloud";
  }

  _getClient() {
    if (!this._client) {
      this._client = createWebdavClient();
    }
    return this._client;
  }

  _isMissing(error) {
    const status =
      error?.status || error?.statusCode || error?.response?.status || null;
    return status === 404;
  }

  async put({ key, data, contentType }) {
    const client = this._getClient();
    const directory = posix.dirname(key);

    try {
      if (directory && directory !== ".") {
        await client.createDirectory(directory, { recursive: true });
      }

      await client.putFileContents(key, data, {
        contentLength: false,
        ...(contentType ? { headers: { "Content-Type": contentType } } : {}),
      });

      return { key, size: data?.length ?? 0 };
    } catch (error) {
      throw this._toStorageError(error, "storage_put_failed", key);
    }
  }

  async getStream({ key }) {
    const client = this._getClient();

    try {
      // Streams are not retried — they can fail mid-transfer.
      return client.createReadStream(key);
    } catch (error) {
      throw this._toStorageError(error, "storage_get_stream_failed", key);
    }
  }

  async getBuffer({ key }) {
    const client = this._getClient();

    try {
      const contents = await client.getFileContents(key);
      return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    } catch (error) {
      throw this._toStorageError(error, "storage_get_buffer_failed", key);
    }
  }

  async stat({ key }) {
    const client = this._getClient();

    try {
      const stat = await client.stat(key);

      return {
        size: stat?.size ?? null,
        mime: stat?.mime ?? stat?.contentType ?? null,
        etag: stat?.etag ?? null,
        lastmod: stat?.lastmod ?? null,
      };
    } catch (error) {
      throw this._toStorageError(error, "storage_stat_failed", key);
    }
  }

  async delete({ key }) {
    const client = this._getClient();

    try {
      await client.deleteFile(key);
    } catch (error) {
      this._throwUnlessMissing(error, "storage_delete_failed", key);
    }
  }

  async deleteMany({ keys }) {
    for (const key of keys || []) {
      await this.delete({ key });
    }
  }
}

module.exports = { NextcloudStorageProvider };
