const FileManager = require("../../../commons/data-managers/file-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "next-cloud-controller.js",
  level: process.env.LOG_LEVEL,
});

const PUBLIC_PATH = "public";
const PROTECTED_PATH = "protected";

/**
 * The Next Cloud Controller provides Endpoints to upload and download files from the Next Cloud platform connected to
 * the booking manager instance.
 */
class NextCloudController {
  /**
   * Get a list of all public files related to a tenant.
   */
  static async getFiles(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const includeProtected = request.query.includeProtected !== "false";

    try {
      let files = [];

      const publicFiles = await FileManager.getFiles(tenant, PUBLIC_PATH);
      files = [
        ...publicFiles.map((file) => ({ ...file, accessLevel: "public" })),
      ];

      if (!!user && includeProtected) {
        const protectedFiles = await FileManager.getFiles(
          tenant,
          PROTECTED_PATH,
        );
        files = [
          ...files,
          ...protectedFiles.map((file) => ({
            ...file,
            accessLevel: "protected",
          })),
        ];
      }

      logger.info(
        `${tenant} -- sending ${files.length} files to user ${user?.id}. `,
      );

      response.status(200).send(files);
    } catch (err) {
      logger.error("Error getting files from Next Cloud.", err);
      response.status(500).send("Error getting files from Next Cloud.");
    }
  }

  /**
   * Download a file from the public folder of a tenant.
   */
  static async getFile(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const filename = request.query.name;

    if (!tenant || !filename) {
      logger.warn(
        `${tenant} -- could not get file for user ${user?.id}. Missing required parameters.`,
      );
      response.status(400).send("Missing required parameters.");
      return;
    }
    try {
      if (!!user || filename.startsWith(`/${PUBLIC_PATH}/`)) {
        const content = await FileManager.getFile(tenant, filename);
        logger.info(
          `${tenant} -- sending file ${filename} to user ${user?.id}`,
        );
        response.setHeader(
          "Content-Disposition",
          `attachment; filename=${filename}`,
        );
        response.status(200).send(content);
      } else {
        logger.warn(
          `${tenant} -- could not get file for user ${user?.id}. Unauthorized.`,
        );
        response.status(401).send("Unauthorized.");
      }
    } catch (err) {
      logger.error("Error downloading file from Next Cloud.", err);
      response.status(500).send("Error downloading file from Next Cloud.");
    }
  }

  /**
   * Upload a file to the public folder of a tenant.
   */
  static async createFile(request, response) {
    const tenant = request.params.tenant;
    const file = request.files.file;
    const accessLevel = request.body.accessLevel;
    const customDirectory = request.body.customDirectory;

    const user = request.user;
    if (!user) {
      logger.warn(`${tenant} -- could not upload file. Unauthorized.`);
      response.status(401).send("Unauthorized.");
      return;
    }

    if (!tenant || !file) {
      logger.warn(
        `${tenant} -- could not upload file. Missing required parameters.`,
      );
      response.status(400).send("Missing required parameters.");
      return;
    }

    // Check if filename is valid and does not contain exploits
    if (!file.name || file.name.includes("..") || file.name.includes("/")) {
      response.status(400).send("Invalid filename.");
      return;
    }

    try {
      const subDirectory =
        (accessLevel === "public" ? PUBLIC_PATH : PROTECTED_PATH) +
        "/" +
        customDirectory;
      await FileManager.createFile(tenant, file, accessLevel, subDirectory);
      logger.info(
        `${tenant} -- file uploaded successfully by user ${user?.id}.`,
      );
      response.status(201).send("File uploaded successfully.");
    } catch (err) {
      logger.error("Error uploading file to Next Cloud.", err);
      response.status(500).send("Error uploading file to Next Cloud.");
    }
  }
}

module.exports = NextCloudController;
