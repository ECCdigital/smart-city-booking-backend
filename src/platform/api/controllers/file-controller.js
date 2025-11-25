const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");
const bunyan = require("bunyan");
const mime = require("mime-types");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");

const logger = bunyan.createLogger({
  name: "file-controller.js",
  level: process.env.LOG_LEVEL,
});

const PUBLIC_PATH = "public";
const PROTECTED_PATH = "protected";

/**
 * The Next Cloud Controller provides Endpoints to upload and download files from the Next Cloud platform connected to
 * the booking manager instance.
 */
class FileController {
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
      const files = await NextcloudManager.getFiles(tenant, PUBLIC_PATH);
      const publicFiles = files.map((file) => ({
        ...file,
        accessLevel: "public",
      }));

      let protectedFiles = [];
      if ((await authenticateIfNeeded(request, true)) && includeProtectedBool) {
        const protectedFilesData = await NextcloudManager.getFiles(
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
      logger.error("Error getting files from Next Cloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        response.status(statusCode).send({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      } else {
        response.status(500).send({
          error: "Error getting files from Next Cloud.",
        });
      }
    }
  }

  /**
   * Download a file from the public folder of a tenant.
   */
  static async getFile(request, response) {
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

      if (
        isPublicPath ||
        (isProtected && (await authenticateIfNeeded(request, true)))
      ) {
        const stat = await NextcloudManager.statFile(tenant, filename);

        const contentType =
          mime.lookup(filename) || stat?.mime || "application/octet-stream";
        response.setHeader("Content-Type", contentType);

        if (isPublicPath) {
          response.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable"
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

        const stream = await NextcloudManager.createReadStream(
          tenant,
          filename
        );

        logger.info(`${tenant} -- sending file ${filename}`);
        response.setHeader("Content-Disposition", "inline");

        // Handle stream errors to prevent crashes
        stream.on("error", (streamError) => {
          logger.error("Error during file streaming from Next Cloud.", {
            error: streamError.message,
            statusCode: streamError.status || 500,
            tenant,
            filename,
          });

          // Only send error response if headers haven't been sent
          if (!response.headersSent) {
            const statusCode = streamError.status >= 500 ? 503 : 500;
            response.status(statusCode).send({
              error:
                "Error streaming file from Nextcloud. Please try again later.",
              details:
                process.env.NODE_ENV === "development"
                  ? streamError.message
                  : undefined,
            });
          } else {
            // Headers already sent, just destroy the response
            response.destroy();
          }
        });

        // Handle client disconnections
        request.on("close", () => {
          if (!response.writableEnded) {
            stream.destroy();
          }
        });

        stream.pipe(response);
      } else {
        logger.warn(`${tenant} -- Unauthorized.`);
        response.status(401).send("Unauthorized.");
      }
    } catch (err) {
      logger.error("Error downloading file from Next Cloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
        filename,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        response.status(statusCode).send({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      } else {
        response.status(500).send({
          error: "Error downloading file from Next Cloud.",
        });
      }
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
      await NextcloudManager.createFile(
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
      logger.error("Error uploading file to Next Cloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
        filename: file?.name,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        response.status(statusCode).send({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      } else {
        response.status(500).send({
          error: "Error uploading file to Next Cloud.",
        });
      }
    }
  }
}

module.exports = FileController;
