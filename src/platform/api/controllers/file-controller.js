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
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} = require("../../../errors/BaseError");
const {
  PUBLIC_ROOT,
  legacyRoot,
  normaliseLegacyPath,
} = require("../../../commons/services/media/legacy-path");
const {
  assertInstanceMediaFileAccess,
  assertMediaFileAccess,
  hasActiveMembership,
} = require("../../../commons/services/media/media-access");
const {
  readsRecords,
  scopeFor,
  scopeOf,
} = require("../../../commons/services/authorization");
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
   * Answers a resolver request in one scope.
   *
   * @param {Object} request - Express request.
   * @param {Object} response - Express response.
   * @param {Function} next - Express next.
   * @param {Object} scope - Tenant or instance scope behaviour.
   * @returns {Promise<void>}
   */
  static async _resolve(request, response, next, scope) {
    let legacyPath;

    try {
      legacyPath = FileController._requireLegacyPath(request);
      const tenantId = scope.tenantId(request);

      const media = await MediaManager.getMediaByLegacyPath(
        tenantId,
        legacyPath,
      );

      if (media) {
        await scope.assertMediaAccess(request, media);
        return await FileController._sendMedia(request, response, next, media);
      }

      // Once the import has run, the library is the whole truth: an address
      // nothing answers for is gone, not waiting in the old tree.
      if (!(await isImportPending())) {
        throw new NotFoundError("file_not_found", { name: legacyPath });
      }

      await scope.assertLegacyAccess(request, legacyPath);

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
   * Read access to a file the import has not taken over yet. Public files stay
   * anonymous; everything else needs an active membership in the owning tenant
   * — the old check let any signed-in user through, whatever tenant they
   * belonged to (§4.3).
   *
   * @param {Object} request - Express request.
   * @param {string} tenantId - Tenant of the file.
   * @param {string} legacyPath - The requested path.
   * @returns {Promise<void>}
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertLegacyTenantAccess(request, tenantId, legacyPath) {
    if (legacyRoot(legacyPath) === PUBLIC_ROOT) {
      return;
    }

    const { reach, userId } = scopeOf(request);

    if (!userId) {
      throw new UnauthorizedError("unauthorized");
    }

    if (reach === "any") {
      return;
    }

    if (!(await hasActiveMembership(userId, tenantId))) {
      throw new ForbiddenError("forbidden");
    }
  }

  /**
   * Read access to a tenant-less legacy file. There is no membership that could
   * narrow it, so `intern` means any signed-in user of the instance (§4.9).
   *
   * @param {Object} request - Express request.
   * @param {string} legacyPath - The requested path.
   * @returns {void}
   * @throws {UnauthorizedError}
   */
  static _assertLegacyInstanceAccess(request, legacyPath) {
    if (legacyRoot(legacyPath) === PUBLIC_ROOT) {
      return;
    }

    if (!readsRecords(scopeOf(request))) {
      throw new UnauthorizedError("unauthorized");
    }
  }

  /**
   * Resolve a tenant-less legacy address.
   */
  static async getFile(request, response, next) {
    return await FileController._resolve(request, response, next, {
      tenantId: () => null,
      assertMediaAccess: (req, media) =>
        assertInstanceMediaFileAccess(media, scopeOf(req)),
      assertLegacyAccess: (req, legacyPath) =>
        FileController._assertLegacyInstanceAccess(req, legacyPath),
    });
  }

  /**
   * Resolve a legacy address of a tenant.
   */
  static async getTenantFile(request, response, next) {
    return await FileController._resolve(request, response, next, {
      tenantId: (req) => req.params.tenant,
      assertMediaAccess: (req, media) =>
        assertMediaFileAccess(media, {
          file: scopeOf(req),
          document: scopeFor(req, "media", "bookingDocument"),
        }),
      assertLegacyAccess: (req, legacyPath) =>
        FileController._assertLegacyTenantAccess(
          req,
          req.params.tenant,
          legacyPath,
        ),
    });
  }
}

module.exports = FileController;
