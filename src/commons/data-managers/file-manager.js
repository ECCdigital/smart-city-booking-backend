const { createClient } = require("webdav");

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

  static async getFiles(tenant, rootPath) {
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
  }

  static async getFile(tenant, filename) {
    const client = NextcloudManager._getClient();
    return await client.getFileContents(`${tenant}/${filename}`);
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
    const client = NextcloudManager._getClient();
    const path = `${tenant}/${filename}`;
    return client.createReadStream(path);
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
    const client = NextcloudManager._getClient();
    const path = `${tenant}/${filename}`;
    const s = await client.stat(path);
    return {
      etag: s.etag,
      lastmod: s.lastmod,
      size: s.size,
      mime: s.mime || s.contentType,
    };
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
    const client = NextcloudManager._getClient();
    const directory = `${tenant}/${subDirectory}`;
    let nextCloudPath = `${directory}/${fileName}`;
    await client.createDirectory(directory, { recursive: true });
    await client.putFileContents(nextCloudPath, file, { contentLength: false });
  }
}

module.exports = {
  FileManager,
  NextcloudManager,
};
