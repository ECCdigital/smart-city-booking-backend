const bunyan = require("bunyan");
const mime = require("mime-types");

const MediaManager = require("../../../commons/data-managers/media-manager");
const MediaService = require("../../../commons/services/media/media-service");
const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");
const {
  applyCacheHeaders,
  CACHE_POLICY,
} = require("../../../commons/utilities/cache-headers");
const {
  BadRequestError,
  BaseError,
  NotFoundError,
} = require("../../../errors/BaseError");
const {
  PUBLIC_ROOT,
  legacyRoot,
  normaliseLegacyPath,
} = require("../../../commons/services/media/legacy-path");
const {
  assertFileReadable,
  legacyFileReadable,
} = require("../../../commons/services/media/media-rights");
const { reachesOf } = require("../../../commons/services/authorization");
const {
  isImportPending,
} = require("../../../commons/services/media/media-import-status");

const logger = bunyan.createLogger({
  name: "file-controller.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * The permanent resolver of legacy file addresses (§4.10 of the media spec).
 * Stored URLs in old mails, bookmarks and exports must not break, so this route
 * stays for good: it looks a medium up by the place its bytes had in the old
 * tree and delivers it with the media header matrix (§4.6).
 *
 * Until the media import has run, the same route still serves the legacy tree
 * directly — but with the media permission checks in front of it, never with
 * the old "any signed-in user may read protected files" rule.
 */
class FileController {
  /**
   * The legacy path a request asks for.
   *
   * @param {Object} request - Express request.
   * @returns {string} The normalised legacy path.
   * @throws {BadRequestError} When the parameter is missing or unusable.
   */
  static _requireLegacyPath(request) {
    const legacyPath = normaliseLegacyPath(request.query?.name);

    if (!legacyPath) {
      throw new BadRequestError("missing_file_name");
    }

    return legacyPath;
  }

  /**
   * Serves a medium the resolver found: the same bytes, headers and cache
   * policy the media route would answer with.
   *
   * @param {Object} request - Express request.
   * @param {Object} response - Express response.
   * @param {Function} next - Express next.
   * @param {Object} media - The resolved medium.
   * @returns {Promise<void>}
   */
  static async _sendMedia(request, response, next, media) {
    const delivery = MediaService.describeDelivery(media);

    if (
      applyCacheHeaders(request, response, {
        cacheControl: delivery.cacheControl,
        etag: delivery.etag,
      })
    ) {
      response.status(304).end();
      return;
    }

    const stream = await MediaService.getStream(media, delivery.key);

    response.setHeader("Content-Type", delivery.contentType);
    response.setHeader("Content-Disposition", delivery.disposition);
    if (delivery.contentLength) {
      response.setHeader("Content-Length", delivery.contentLength);
    }

    FileController._pipe(
      request,
      response,
      stream,
      { mediaId: media.id },
      next,
    );
  }

  /**
   * Serves a file straight from the legacy tree — the fallback for an
   * installation whose media import has not run yet. The bytes come from the
   * old place, the permission check is the new one.
   *
   * @param {Object} request - Express request.
   * @param {Object} response - Express response.
   * @param {Function} next - Express next.
   * @param {Object} params
   * @param {string|null} params.tenantId - Tenant of the file.
   * @param {string} params.legacyPath - The path to serve.
   * @returns {Promise<void>}
   */
  static async _sendLegacyFile(
    request,
    response,
    next,
    { tenantId, legacyPath },
  ) {
    const isPublic = legacyRoot(legacyPath) === PUBLIC_ROOT;

    const stat = await NextcloudManager.statFile({
      tenantID: tenantId || undefined,
      filename: legacyPath,
    });

    // The legacy tree has no checksum of its own, so its validators are the
    // ones the storage reports.
    if (
      applyCacheHeaders(request, response, {
        cacheControl: isPublic
          ? CACHE_POLICY.PUBLIC_IMMUTABLE
          : CACHE_POLICY.PRIVATE_NO_CACHE,
        etag: stat?.etag,
        lastModified: stat?.lastmod,
      })
    ) {
      response.status(304).end();
      return;
    }

    response.setHeader(
      "Content-Type",
      mime.lookup(legacyPath) || stat?.mime || "application/octet-stream",
    );
    response.setHeader("Content-Disposition", "inline");

    const stream = await NextcloudManager.createReadStream({
      tenantID: tenantId || undefined,
      filename: legacyPath,
    });

    FileController._pipe(
      request,
      response,
      stream,
      { tenantId, legacyPath },
      next,
    );
  }

  /**
   * Pipes a file stream to the response. Once the first byte is out there is no
   * way back to an error page — the wire is cut instead; before that the
   * central error handler still answers.
   *
   * @param {Object} request - Express request.
   * @param {Object} response - Express response.
   * @param {Object} stream - The readable stream.
   * @param {Object} context - What was being served, for the log.
   * @param {Function} [next] - Express next, where one is still usable.
   * @returns {void}
   */
  static _pipe(request, response, stream, context, next) {
    stream.on("error", (streamError) => {
      logger.error(
        { err: streamError, ...context },
        "Error while streaming a legacy file address",
      );

      if (response.headersSent) {
        response.destroy();
        return;
      }

      response.removeHeader("Content-Type");
      response.removeHeader("Content-Disposition");
      response.removeHeader("Content-Length");
      response.removeHeader("Cache-Control");
      response.removeHeader("ETag");
      response.removeHeader("Last-Modified");

      const failure = new BaseError("file_stream_failed", 503);

      if (next) {
        next(failure);
      } else {
        response.status(failure.statusCode).json(failure.toJSON());
      }
    });

    request.on("close", () => {
      if (!response.writableEnded) {
        stream.destroy();
      }
    });

    stream.pipe(response);
  }

  /**
   * Answers a resolver request in the tenant it names, or on the instance.
   * Who may read what is the media rights', from the questions the route's
   * marker named: an imported medium follows its visibility, a file of the
   * old tree is read as an internal medium unless it lies in the public root.
   *
   * @param {Object} request - Express request.
   * @param {Object} response - Express response.
   * @param {Function} next - Express next.
   * @param {string|null} tenantId - The tenant, `null` on the instance.
   * @returns {Promise<void>}
   */
  static async _resolve(request, response, next, tenantId) {
    let legacyPath;

    try {
      legacyPath = FileController._requireLegacyPath(request);

      const media = await MediaManager.getMediaByLegacyPath(
        tenantId,
        legacyPath,
      );

      if (media) {
        await assertFileReadable(media, reachesOf(request));
        return await FileController._sendMedia(request, response, next, media);
      }

      // Once the import has run, the library is the whole truth: an address
      // nothing answers for is gone, not waiting in the old tree.
      if (!(await isImportPending())) {
        throw new NotFoundError("file_not_found", { name: legacyPath });
      }

      legacyFileReadable(
        { isPublic: legacyRoot(legacyPath) === PUBLIC_ROOT, tenantId },
        reachesOf(request),
      );

      return await FileController._sendLegacyFile(request, response, next, {
        tenantId,
        legacyPath,
      });
    } catch (error) {
      if (error?.isNextcloudError) {
        logger.warn(
          { err: error, legacyPath },
          "Legacy storage could not answer",
        );

        return next(
          new BaseError(
            "legacy_storage_unavailable",
            error.statusCode >= 500 || !error.statusCode
              ? 503
              : error.statusCode,
            { name: legacyPath },
          ),
        );
      }

      // Express 4 does not forward rejected handlers on its own.
      return next(error);
    }
  }

  /**
   * Resolve a tenant-less legacy address.
   */
  static async getFile(request, response, next) {
    return await FileController._resolve(request, response, next, null);
  }

  /**
   * Resolve a legacy address of a tenant.
   */
  static async getTenantFile(request, response, next) {
    return await FileController._resolve(
      request,
      response,
      next,
      request.params.tenant,
    );
  }
}

module.exports = FileController;
