const { createClient } = require("webdav");

function _getClient() {
  const nextCloudUrl = process.env.NEXTCLOUD_URL;
  return createClient(`${nextCloudUrl}/remote.php/webdav`, {
    username: process.env.NEXTCLOUD_USERNAME,
    password: process.env.NEXTCLOUD_PASSWORD,
  });
}

class FileManager {
  static async getFiles(tenant, rootPath) {
    const client = _getClient();

    const directoryItems = await client.getDirectoryContents(
      `${tenant}/${rootPath}`,
      {
        deep: true,
      }
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
    const client = _getClient();
    return await client.getFileContents(`${tenant}/${filename}`);
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
    const client = _getClient();
    const directory = `${tenant}/${subDirectory}`;
    let nextCloudPath = `${directory}/${fileName}`;
    await client.createDirectory(directory, { recursive: true });
    await client.putFileContents(nextCloudPath, file, {contentLength: false});
  }
}

module.exports = FileManager;
