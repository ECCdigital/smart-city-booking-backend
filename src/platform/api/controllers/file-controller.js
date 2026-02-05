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

const withAccessLevel = (files, level) =>
  files.map((file) => ({ ...file, accessLevel: level }));

const safeGetFiles = async (tenant, path, accessLevel) => {
  try {
    const files = await NextcloudManager.getFiles(tenant, path);
    return withAccessLevel(files, accessLevel);
  } catch (err) {
    logger.warn(`Failed to fetch ${accessLevel} files`, {
      tenant,
      error: err.message,
    });
    return [];
  }
};

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

    if (!tenant) {
      return response.status(400).json({ error: "Tenant is required." });
    }

    const includeProtectedBool = includeProtected === "true";

    try {
      const canAccessProtected =
        includeProtectedBool && (await authenticateIfNeeded(request, true));

      const [publicFiles, protectedFiles] = await Promise.all([
        safeGetFiles(tenant, PUBLIC_PATH, "public"),
        canAccessProtected
          ? safeGetFiles(tenant, PROTECTED_PATH, "protected")
          : [],
      ]);

      const allFiles = [...publicFiles, ...protectedFiles];

      logger.info(
        `${tenant} -- sending ${allFiles.length} files to user ${user?.id ?? "anonymous"}`,
      );

      return response.status(200).json(allFiles);
    } catch (err) {
      logger.error("Error getting files from Nextcloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        return response.status(statusCode).json({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }

      return response.status(500).json({
        error: "Error getting files from Nextcloud.",
      });
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
      return response.status(400).send("Missing required parameters.");
    }

    try {
      const isPublicPath = filename.startsWith(`/${PUBLIC_PATH}/`);
      const isProtectedPath = filename.startsWith(`/${PROTECTED_PATH}/`);

      const hasAccess =
        isPublicPath ||
        (isProtectedPath && (await authenticateIfNeeded(request, true)));

      if (!hasAccess) {
        logger.warn(`${tenant} -- Unauthorized.`);
        return response.status(401).send("Unauthorized.");
      }

      const stat = await NextcloudManager.statFile(tenant, filename);

      const contentType =
        mime.lookup(filename) || stat?.mime || "application/octet-stream";
      response.setHeader("Content-Type", contentType);
      response.setHeader(
        "Cache-Control",
        isPublicPath
          ? "public, max-age=31536000, immutable"
          : "private, max-age=0, no-cache",
      );
      response.setHeader("Content-Disposition", "inline");

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

      const stream = await NextcloudManager.createReadStream(tenant, filename);

      logger.info(`${tenant} -- sending file ${filename}`);

      stream.on("error", (streamError) => {
        logger.error("Error during file streaming from Nextcloud.", {
          error: streamError.message,
          statusCode: streamError.status || 500,
          tenant,
          filename,
        });

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
          response.destroy();
        }
      });

      request.on("close", () => {
        if (!response.writableEnded) {
          stream.destroy();
        }
      });

      stream.pipe(response);
    } catch (err) {
      logger.error("Error downloading file from Nextcloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
        filename,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        return response.status(statusCode).send({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }

      return response.status(500).send({
        error: "Error downloading file from Nextcloud.",
      });
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
      return response.status(400).send("Missing required parameters.");
    }

    if (!file.name || file.name.includes("..") || file.name.includes("/")) {
      return response.status(400).send("Invalid filename.");
    }

    try {
      const basePath = accessLevel === "public" ? PUBLIC_PATH : PROTECTED_PATH;
      const subDirectory = `${basePath}/${customDirectory}`;

      await NextcloudManager.createFile(
        tenant,
        file.data,
        file.name,
        accessLevel,
        subDirectory,
      );

      logger.info(
        `${tenant} -- file uploaded successfully by user ${user?.id ?? "anonymous"}.`,
      );

      return response.status(201).send("File uploaded successfully.");
    } catch (err) {
      logger.error("Error uploading file to Nextcloud.", {
        error: err.message,
        statusCode: err.statusCode,
        tenant,
        filename: file?.name,
      });

      if (err.isNextcloudError) {
        const statusCode = err.statusCode >= 500 ? 503 : err.statusCode;
        return response.status(statusCode).send({
          error:
            "Nextcloud service is currently unavailable. Please try again later.",
          details:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }

      return response.status(500).send({
        error: "Error uploading file to Nextcloud.",
      });
    }
  }
}

module.exports = FileController;
