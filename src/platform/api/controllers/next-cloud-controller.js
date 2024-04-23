const FileManager = require("../../../commons/data-managers/file-manager");
const bunyan = require("bunyan");
const UserManager = require("../../../commons/data-managers/user-manager");
const { RolePermission } = require("../../../commons/entities/role");

const logger = bunyan.createLogger({
  name: "next-cloud-controller.js",
  level: process.env.LOG_LEVEL,
});

const PUBLIC_PATH = "public";
const PROTECTED_PATH = "protected";
const RECEIPTS_PATH = "receipts";

/**
 * The Next Cloud Controller provides Endpoints to upload and download files from the Next Cloud platform connected to
 * the booking manager instance.
 */
class NextCloudController {
  /**
   * Get a list of all public files related to a tenant.
   */
  static async getFiles(request, response) {
    const {
      params: { tenant },
      user,
      query: { includeProtected = "false" },
    } = request;
    const includeProtectedBool = includeProtected !== "false";

    try {
      const files = await FileManager.getFiles(tenant, PUBLIC_PATH);
      const publicFiles = files.map((file) => ({
        ...file,
        accessLevel: "public",
      }));

      let protectedFiles = [];
      if (request.isAuthenticated() && includeProtectedBool) {
        const protectedFilesData = await FileManager.getFiles(
          tenant,
          PROTECTED_PATH,
        );
        protectedFiles = protectedFilesData.map((file) => ({
          ...file,
          accessLevel: "protected",
        }));
      }

      const allFiles = [...publicFiles, ...protectedFiles];
      logger.info(
        `${tenant} -- sending ${allFiles.length} files to user ${user?.id}. `,
      );
      response.status(200).send(allFiles);
    } catch (err) {
      logger.error("Error getting files from Next Cloud.", err);
      response.status(500).send("Error getting files from Next Cloud.");
    }
  }

  /**
   * Download a file from the public folder of a tenant.
   */
  static async getFile(request, response) {
    const {
      params: { tenant },
      user,
      query: { name: filename },
    } = request;

    if (!tenant || !filename) {
      logger.warn(`${tenant} -- Missing required parameters.`);
      response.status(400).send("Missing required parameters.");
      return;
    }

    try {
      const isPublicPath = filename.startsWith(`/${PUBLIC_PATH}/`);
      const isProtected = filename.startsWith(`/${PROTECTED_PATH}/`);
      const isReceiptsPath = filename.startsWith(`/${RECEIPTS_PATH}/`);
      const readPermissions = await UserManager.hasPermission(
        user?.id,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readAny",
      );

      if (
        isPublicPath ||
        (isProtected && request.isAuthenticated()) ||
        (isReceiptsPath && readPermissions && request.isAuthenticated())
      ) {
        const content = await FileManager.getFile(tenant, filename);
        logger.info(`${tenant} -- sending file ${filename}`);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename=${filename}`,
        );
        response.status(200).send(content);
      } else {
        logger.warn(`${tenant} -- Unauthorized.`);
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
    const {
      params: { tenant },
      user,
      files: { file },
      body: { accessLevel, customDirectory },
    } = request;

    const createPermissions = await UserManager.hasPermission(
      user?.id,
      tenant,
      RolePermission.MANAGE_BOOKABLES,
      "create",
    );

    if (!createPermissions) {
      logger.warn(`${tenant} -- Unauthorized.`);
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
      await FileManager.createFile(
        tenant,
        file.data,
        file.name,
        accessLevel,
        subDirectory,
      );
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
