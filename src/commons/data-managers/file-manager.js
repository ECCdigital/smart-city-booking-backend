const { createClient } = require("webdav");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "file-manager.js",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Custom error class for Nextcloud-related errors
 */
class NextcloudError extends Error {
  constructor(message, statusCode, originalError) {
    super(message);
    this.name = "NextcloudError";
    this.statusCode = statusCode;
    this.originalError = originalError;
    this.isNextcloudError = true;
  }
}

class FileManager {
  static async getFiles() {}

  static async getFile() {}

  static async createFile() {}
}

class NextcloudManager extends FileManager {
  static TIMEOUT = 30000; // 30 seconds
  static MAX_RETRIES = 3;
  static RETRY_DELAY = 1000; // 1 second

  static _getClient() {
    const nextCloudUrl = process.env.NEXTCLOUD_URL;

    if (!nextCloudUrl || !process.env.NEXTCLOUD_USERNAME || !process.env.NEXTCLOUD_PASSWORD) {
      throw new NextcloudError(
        "Nextcloud configuration is missing. Please check environment variables.",
        500
      );
    }

    return createClient(`${nextCloudUrl}/remote.php/webdav`, {
      username: process.env.NEXTCLOUD_USERNAME,
      password: process.env.NEXTCLOUD_PASSWORD,
      timeout: NextcloudManager.TIMEOUT,
      maxBodyLength: 100 * 1024 * 1024, // 100MB
      maxContentLength: 100 * 1024 * 1024, // 100MB
    });
  }

  /**
   * Retry a function with exponential backoff
   * @private
   */
  static async _retryWithBackoff(fn, retries = NextcloudManager.MAX_RETRIES) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (4xx), only on server errors (5xx) or network errors
        if (error.response?.status && error.response.status < 500) {
          throw NextcloudManager._handleError(error, "Nextcloud client error");
        }

        if (attempt < retries) {
          const delay = NextcloudManager.RETRY_DELAY * Math.pow(2, attempt);
          logger.warn(
            `Nextcloud request failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${delay}ms...`,
            { error: error.message }
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw NextcloudManager._handleError(
      lastError,
      `Nextcloud request failed after ${retries + 1} attempts`
    );
  }

  /**
   * Handle and normalize errors
   * @private
   */
  static _handleError(error, defaultMessage = "Nextcloud operation failed") {
    if (error.isNextcloudError) {
      return error;
    }

    const statusCode = error.response?.status || 503;
    const statusText = error.response?.statusText || "Service Unavailable";
    const message = error.message || defaultMessage;

    logger.error("Nextcloud error occurred:", {
      message,
      statusCode,
      statusText,
      originalError: error.message,
    });

    return new NextcloudError(
      `${defaultMessage}: ${statusCode} ${statusText}`,
      statusCode,
      error
    );
  }

  static async getFiles(tenant, rootPath) {
    try {
      return await NextcloudManager._retryWithBackoff(async () => {
        const client = NextcloudManager._getClient();

        const directoryItems = await client.getDirectoryContents(
          `${tenant}/${rootPath}`,
          {
            deep: true,
          },
        );

        return directoryItems
          .filter((item) => item.type === "file")
          .map((item) => {
            const croppedFilename = item.filename.replace(`${tenant}/`, "");
            return {
              ...item,
              filename: croppedFilename,
              link: `${process.env.BACKEND_URL}/api/${tenant}/files/get?name=${croppedFilename}`,
            };
          });
      });
    } catch (error) {
      logger.error(`Failed to get files for tenant ${tenant} at ${rootPath}`, {
        error: error.message,
      });
      throw NextcloudManager._handleError(error, "Failed to retrieve files");
    }
  }

  static async getFile(tenant, filename) {
    try {
      return await NextcloudManager._retryWithBackoff(async () => {
        const client = NextcloudManager._getClient();
        return await client.getFileContents(`${tenant}/${filename}`);
      });
    } catch (error) {
      logger.error(`Failed to get file ${filename} for tenant ${tenant}`, {
        error: error.message,
      });
      throw NextcloudManager._handleError(error, "Failed to retrieve file");
    }
  }

  /**
   * Creates a readable stream for a specific file in the Nextcloud server.
   *
   * This method uses the WebDAV client to create a readable stream for the file
   * identified by the combination of the tenant and filename. The stream can be
   * used to read the file's contents in chunks.
   *
   * @param {string} tenant - The tenant ID. This is used to locate the tenant-specific directory in the Nextcloud server.
   * @param {string} filename - The name of the file for which the readable stream is to be created.
   * @returns {ReadableStream} A readable stream for the specified file.
   *
   * @example
   * const stream = NextcloudManager.createReadStream('tenant1', 'example.txt');
   * stream.pipe(process.stdout);
   */
  static async createReadStream(tenant, filename) {
    try {
      return await NextcloudManager._retryWithBackoff(async () => {
        const client = NextcloudManager._getClient();
        const path = `${tenant}/${filename}`;
        return client.createReadStream(path);
      });
    } catch (error) {
      logger.error(
        `Failed to create read stream for file ${filename} for tenant ${tenant}`,
        { error: error.message }
      );
      throw NextcloudManager._handleError(error, "Failed to create read stream");
    }
  }

  /**
   * Retrieves metadata about a specific file in the Nextcloud server.
   *
   * This method uses the WebDAV client to fetch details about a file, such as its
   * ETag, last modification date, size, and MIME type. The file is identified
   * by the combination of the tenant and filename.
   *
   * @param {string} tenant - The tenant ID. This is used to locate the tenant-specific directory in the Nextcloud server.
   * @param {string} filename - The name of the file whose metadata is to be retrieved.
   * @returns {Promise<Object>} A promise that resolves to an object containing the file's metadata:
   * - `etag` {string}: The ETag of the file.
   * - `lastmod` {string}: The last modification date of the file.
   * - `size` {number}: The size of the file in bytes.
   * - `mime` {string}: The MIME type of the file.
   *
   * @example
   * const metadata = await NextcloudManager.statFile('tenant1', 'example.txt');
   * console.log(metadata);
   */
  static async statFile(tenant, filename) {
    try {
      return await NextcloudManager._retryWithBackoff(async () => {
        const client = NextcloudManager._getClient();
        const path = `${tenant}/${filename}`;
        const s = await client.stat(path);
        return {
          etag: s.etag,
          lastmod: s.lastmod,
          size: s.size,
          mime: s.mime || s.contentType,
        };
      });
    } catch (error) {
      logger.error(`Failed to stat file ${filename} for tenant ${tenant}`, {
        error: error.message,
      });
      throw NextcloudManager._handleError(error, "Failed to retrieve file metadata");
    }
  }

  /**
   * Creates a file in the specified directory.
   *
   * This method uses the webdav client to interact with the Nextcloud server.
   * It first creates the directory (if it doesn't exist) and then uploads the file to the directory.
   *
   * @param {string} tenant - The tenant ID. This is used to create a tenant-specific directory in the Nextcloud server.
   * @param {Object} file - The file to be uploaded. It should be an object with `name` and `data` properties.
   * @param {string} fileName - The name of the file to be uploaded.
   * @param {string} accessLevel - The access level for the file. This parameter is currently not used in the method.
   * @param {string} subDirectory - The subdirectory under the tenant directory where the file should be uploaded.
   * @returns {Promise<void>} A promise that resolves when the file has been successfully uploaded.
   *
   * @example
   * FileManager.createFile('tenant1', { name: 'file.txt', data: 'Hello, world!' }, 'public', 'documents');
   */
  static async createFile(tenant, file, fileName, accessLevel, subDirectory) {
    try {
      return await NextcloudManager._retryWithBackoff(async () => {
        const client = NextcloudManager._getClient();
        const directory = `${tenant}/${subDirectory}`;
        let nextCloudPath = `${directory}/${fileName}`;
        await client.createDirectory(directory, { recursive: true });
        await client.putFileContents(nextCloudPath, file, { contentLength: false });
      });
    } catch (error) {
      logger.error(
        `Failed to create file ${fileName} in ${subDirectory} for tenant ${tenant}`,
        { error: error.message }
      );
      throw NextcloudManager._handleError(error, "Failed to create file");
    }
  }
}

module.exports = {
  FileManager,
  NextcloudManager,
  NextcloudError,
};
