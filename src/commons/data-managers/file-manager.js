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

  static async createFile(tenant, file, accessLevel, subDirectory) {
    const client = _getClient();
    const directory = `${tenant}/${subDirectory}`;
    let nextCloudPath = `${directory}/${file.name}`;
    await client.createDirectory(directory, { recursive: true });
    await client.putFileContents(nextCloudPath, file.data, {contentLength: false});
  }
}

module.exports = FileManager;
