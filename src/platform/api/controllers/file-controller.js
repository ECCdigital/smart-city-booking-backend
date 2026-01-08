const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");
const bunyan = require("bunyan");
const mime = require("mime-types");

const logger = bunyan.createLogger({
  name: "next-cloud-controller.js",
  level: process.env.LOG_LEVEL,
});

const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");

const PUBLIC_PATH = "public";
const PROTECTED_PATH = "protected";

/**
 * The Next Cloud Controller provides Endpoints to upload and download files from the Next Cloud platform connected to
 * the booking manager instance.
 */
class FileController {
  static async getFiles(request, response) {
    const {
      user,
      query: { includeProtected = "false" },
    } = request;
    const includeProtectedBool = includeProtected !== "false";

    try {
      const files = await NextcloudManager.getFiles({
        rootPath: PUBLIC_PATH,
      });

      const publicFiles = files.map((file) => ({
        ...file,
        accessLevel: "public",
      }));

      let protectedFiles = [];

      const hasPermission = await authenticateIfNeeded(
        request,
        includeProtectedBool,
      );

      if (hasPermission) {
        const protectedFilesData = await NextcloudManager.getFiles({
          rootPath: PROTECTED_PATH,
        });
        protectedFiles = protectedFilesData.map((file) => ({
          ...file,
          accessLevel: "protected",
        }));
      }

      const allFiles = [...publicFiles, ...protectedFiles];
      logger.info(
        `Instance -- sending ${allFiles.length} files to user ${user?.id}. `,
      );
      response.status(200).send(allFiles);
    } catch (err) {
      logger.error("Error getting files from Next Cloud.", err);
      response.status(500).send("Error getting files from Next Cloud.");
    }
  }

  /**
   * Get a list of all public files related to a tenant.
   */
  static async getTenantFiles(request, response) {
    const {
      params: { tenant },
      user,
      query: { includeProtected = "false" },
    } = request;
    const includeProtectedBool = includeProtected !== "false";

    try {
      const files = await NextcloudManager.getFiles({
        tenant,
        rootPath: PUBLIC_PATH,
      });


      const publicFiles = files.map((file) => ({
        ...file,
        accessLevel: "public",
      }));

      let protectedFiles = [];

      const hasPermission = await authenticateIfNeeded(
        request,
        includeProtectedBool,
      );
      if (hasPermission) {
        const protectedFilesData = await NextcloudManager.getFiles({
          tenant,
          rootPath: PROTECTED_PATH,
        });
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

  static async getFile(request, response) {
    const {
      query: { name: filename },
    } = request;

    if (!filename) {
      logger.warn(`Instance -- Missing required parameters.`);
      response.status(400).send("Missing required parameters.");
      return;
    }

    try {
      const isPublicPath = filename.startsWith(`/${PUBLIC_PATH}/`);
      const isProtected = filename.startsWith(`/${PROTECTED_PATH}/`);

      const hasPermission = await authenticateIfNeeded(request, isProtected);

      if (isPublicPath || hasPermission) {
        const stat = await NextcloudManager.statFile({ filename: filename });

        const contentType =
          mime.lookup(filename) || stat?.mime || "application/octet-stream";
        response.setHeader("Content-Type", contentType);

        if (isPublicPath) {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.setHeader("Cache-Control", "private, max-age=0, no-cache");
        }

        if (stat?.etag) response.setHeader("ETag", stat.etag);
        if (stat?.lastmod) response.setHeader("Last-Modified", stat.lastmod);

        const inm = request.headers["if-none-match"];
        const ims = request.headers["if-modified-since"];
        const notModifiedByEtag = inm && stat?.etag && inm === stat.etag;
        const notModifiedByTime =
          ims && stat?.lastmod && new Date(stat.lastmod) <= new Date(ims);
        if (notModifiedByEtag || notModifiedByTime) {
          return response.status(304).end();
        }

        const stream = await NextcloudManager.createReadStream({
          filename: filename,
        });

        logger.info(`Instance -- sending file ${filename}`);
        response.setHeader("Content-Disposition", "inline");
        stream.pipe(response);
      } else {
        logger.warn(`Instance -- Unauthorized.`);
        response.status(401).send("Unauthorized.");
      }
    } catch (err) {
      logger.error("Error downloading file from Next Cloud.", err);
      response.status(500).send("Error downloading file from Next Cloud.");
    }
  }

  /**
   * Download a file from the public folder of a tenant.
   */
  static async getTenantFile(request, response) {
    const {
      params: { tenant },
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

      const hasPermission = await authenticateIfNeeded(request, isProtected);

      if (isPublicPath || hasPermission) {
        const stat = await NextcloudManager.statFile({
          tenantID: tenant,
          filename: filename,
        });

        const contentType =
          mime.lookup(filename) || stat?.mime || "application/octet-stream";
        response.setHeader("Content-Type", contentType);

        if (isPublicPath) {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.setHeader("Cache-Control", "private, max-age=0, no-cache");
        }

        if (stat?.etag) response.setHeader("ETag", stat.etag);
        if (stat?.lastmod) response.setHeader("Last-Modified", stat.lastmod);

        const inm = request.headers["if-none-match"];
        const ims = request.headers["if-modified-since"];
        const notModifiedByEtag = inm && stat?.etag && inm === stat.etag;
        const notModifiedByTime =
          ims && stat?.lastmod && new Date(stat.lastmod) <= new Date(ims);
        if (notModifiedByEtag || notModifiedByTime) {
          return response.status(304).end();
        }

        const stream = await NextcloudManager.createReadStream({
          tenantID: tenant,
          filename,
        });

        logger.info(`${tenant} -- sending file ${filename}`);
        response.setHeader("Content-Disposition", "inline");
        stream.pipe(response);
      } else {
        logger.warn(`${tenant} -- Unauthorized.`);
        response.status(401).send("Unauthorized.");
      }
    } catch (err) {
      logger.error("Error downloading file from Next Cloud.", err);
      response.status(500).send("Error downloading file from Next Cloud.");
    }
  }

  static async createFile(request, response) {
    const {
      user,
      files: { file },
      body: { accessLevel, customDirectory },
    } = request;

    if (!file) {
      logger.warn(
        `Instance -- could not upload file. Missing required parameters.`,
      );
      response.status(400).send("Missing required parameters.");
      return;
    }

    if (!file.name || file.name.includes("..") || file.name.includes("/")) {
      response.status(400).send("Invalid filename.");
      return;
    }

    try {
      const subDirectory =
        (accessLevel === "public" ? PUBLIC_PATH : PROTECTED_PATH) +
        "/" +
        customDirectory;
      await NextcloudManager.createFile({
        file,
        subDirectory,
      });
      logger.info(
        `Instance -- file uploaded successfully by user ${user?.id}.`,
      );
      response.status(201).send("File uploaded successfully.");
    } catch (err) {
      logger.error("Error uploading file to Next Cloud.", err);
      response.status(500).send("Error uploading file to Next Cloud.");
    }
  }

  /**
   * Upload a file to the public folder of a tenant.
   */
  static async createTenantFile(request, response) {
    const {
      params: { tenant },
      user,
      files: { file },
      body: { accessLevel, customDirectory },
    } = request;

    if (!tenant || !file) {
      logger.warn(
        `${tenant} -- could not upload file. Missing required parameters.`,
      );
      response.status(400).send("Missing required parameters.");
      return;
    }

    if (!file.name || file.name.includes("..") || file.name.includes("/")) {
      response.status(400).send("Invalid filename.");
      return;
    }

    try {
      const subDirectory =
        (accessLevel === "public" ? PUBLIC_PATH : PROTECTED_PATH) +
        "/" +
        customDirectory;
      await NextcloudManager.createFile({
        tenantID: tenant,
        file,
        subDirectory,
      });
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

module.exports = FileController;
