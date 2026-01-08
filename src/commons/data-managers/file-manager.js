const { createClient } = require("webdav");
const { posix } = require("node:path");

class FileManager {
  static async getFiles() {}

  static async getFile() {}

  static async createFile() {}
}

class NextcloudManager extends FileManager {
  static _getClient() {
    const nextCloudUrl = process.env.NEXTCLOUD_URL;
    return createClient(`${nextCloudUrl}/remote.php/webdav`, {
      username: process.env.NEXTCLOUD_USERNAME,
      password: process.env.NEXTCLOUD_PASSWORD,
    });
  }

  static async getFiles({ tenant, rootPath }) {
    if (!rootPath || typeof rootPath !== "string") {
      throw new TypeError("rootPath is required and must be a string");
    }

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new Error("BACKEND_URL is not set");
    }

    const clean = (s) => String(s).replace(/^\/+|\/+$/g, "");

    const tenantClean = tenant ? clean(tenant) : "";
    const rootClean = clean(rootPath);

    const fullPath = [tenantClean, rootClean].filter(Boolean).join("/");

    const client = NextcloudManager._getClient();

    const directoryItems = await client.getDirectoryContents(fullPath, {
      deep: true,
    });

    const basePath = tenantClean
      ? `/api/${tenantClean}/files/get`
      : "/api/files/get";

    return directoryItems
      .filter((item) => item.type === "file")
      .map((item) => {
        const filename = String(item.filename || "");

        const tenantPrefix = tenantClean ? `${tenantClean}/` : "";

        const croppedFilename = tenantPrefix
          ? filename.replace(`${tenant}/`, "")
          : filename;

        const url = new URL(basePath, backendUrl);
        url.searchParams.set("name", croppedFilename);

        return {
          ...item,
          filename: croppedFilename,
          link: url.toString(),
        };
      });
  }

  static async getFile({ tenant, subFolder, filename }) {
    if (!filename || typeof filename !== "string") {
      throw new TypeError("filename is required and must be a string");
    }

    const clean = (s) => String(s).replace(/^\/+|\/+$/g, "");

    const completeFilename = posix.join(
      ...[tenant, subFolder, filename].filter(Boolean).map(clean),
    );

    const client = NextcloudManager._getClient();
    return client.getFileContents(completeFilename);
  }

  /**
   * Creates a readable stream for a specific file in the Nextcloud server.
   *
   * This method uses the WebDAV client to create a readable stream for the file
   * identified by the combination of the tenant and filename. The stream can be
   * used to read the file's contents in chunks.
   *
   * @param {Object} params - The parameters for the method.
   * @param {string} params.tenantID - The tenant ID. This is used to locate the tenant-specific directory in the Nextcloud server.
   * @param {string} params.filename - The name of the file for which the readable stream is to be created.
   * @returns {ReadableStream} A readable stream for the specified file.
   *
   * @example
   * const stream = NextcloudManager.createReadStream('tenant1', 'example.txt');
   * stream.pipe(process.stdout);
   */
  static async createReadStream({ tenantID, filename } = {}) {
    if (!filename || typeof filename !== "string") {
      throw new TypeError("filename is required and must be a string");
    }

    const clean = (s) => String(s).replace(/^\/+|\/+$/g, "");

    const tenantClean = tenantID ? clean(tenantID) : "";
    const filenameClean = clean(filename);

    const segments = [tenantClean, filenameClean].filter(Boolean);
    if (
      segments.some(
        (seg) => seg === ".." || seg.includes("../") || seg.includes("..\\"),
      )
    ) {
      throw new Error("Invalid path segment");
    }

    const path = segments.join("/");

    const client = NextcloudManager._getClient();
    return client.createReadStream(path);
  }

  /**
   * Retrieves metadata about a specific file in the Nextcloud server.
   *
   * This method uses the WebDAV client to fetch details about a file, such as its
   * ETag, last modification date, size, and MIME type. The file is identified
   * by the combination of the tenant and filename.
   *
   * @param {Object} params - The parameters for the method.
   * @param {string} params.tenantID - The tenant ID. This is used to locate the tenant-specific directory in the Nextcloud server.
   * @param {string} params.filename - The name of the file whose metadata is to be retrieved.
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
  static async statFile({ tenantID, filename } = {}) {
    if (!filename || typeof filename !== "string") {
      throw new TypeError("filename is required and must be a string");
    }

    const clean = (s) => String(s).replace(/^\/+|\/+$/g, "");

    const tenantClean = tenantID ? clean(tenantID) : "";
    const filenameClean = clean(filename);

    const segments = [tenantClean, filenameClean].filter(Boolean);
    if (
      segments.some(
        (seg) => seg === ".." || seg.includes("../") || seg.includes("..\\"),
      )
    ) {
      throw new Error("Invalid path segment");
    }

    const path = segments.join("/");

    const client = NextcloudManager._getClient();
    const s = await client.stat(path);

    return {
      etag: s?.etag,
      lastmod: s?.lastmod,
      size: s?.size,
      mime: s?.mime ?? s?.contentType,
    };
  }

  /**
   * Creates a file in the specified directory.
   *
   * This method uses the webdav client to interact with the Nextcloud server.
   * It first creates the directory (if it doesn't exist) and then uploads the file to the directory.
   *
   * @param {string} tenantID - The tenant ID. This is used to create a tenant-specific directory in the Nextcloud server.
   * @param {Object} file - The file to be uploaded. It should be an object with `name` and `data` properties.
   * @param {string} accessLevel - The access level for the file. This parameter is currently not used in the method.
   * @param {string} subDirectory - The subdirectory under the tenant directory where the file should be uploaded.
   * @returns {Promise<string>} A promise that resolves to the path of the created file in the Nextcloud server.
   *
   * @example
   * FileManager.createFile('tenant1', { name: 'file.txt', data: 'Hello, world!' }, 'public', 'documents');
   */
  static async createFile({ tenantID, file, subDirectory }) {
    if (!file || typeof file !== "object") {
      throw new TypeError("file is required");
    }

    if (!file.name || typeof file.name !== "string") {
      throw new TypeError("file.name is required and must be a string");
    }

    const clean = (s) => String(s).replace(/^\/+|\/+$/g, "");

    const tenant = tenantID ? clean(tenantID) : "";
    const subDir = subDirectory ? clean(subDirectory) : "";
    const fileName = clean(file.name);

    const segments = [tenant, subDir, fileName].filter(Boolean);
    if (
      segments.some(
        (seg) => seg === ".." || seg.includes("../") || seg.includes("..\\"),
      )
    ) {
      throw new Error("Invalid path segment");
    }

    const directory = [tenant, subDir].filter(Boolean).join("/");
    const nextCloudPath = [directory, fileName].filter(Boolean).join("/");

    const client = NextcloudManager._getClient();

    if (directory) {
      await client.createDirectory(directory, { recursive: true });
    }

    await client.putFileContents(nextCloudPath, file.data, {
      contentLength: false,
    });

    return nextCloudPath;
  }
}

module.exports = {
  FileManager,
  NextcloudManager,
};
