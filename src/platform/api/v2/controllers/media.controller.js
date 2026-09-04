const bunyan = require("bunyan");

const MediaManager = require("../../../../commons/data-managers/media-manager");
const MediaService = require("../../../../commons/services/media/media-service");
const {
  ownCondition,
  scopeFor,
  scopeOf,
  withinReach,
} = require("../../../../commons/services/authorization");
const {
  MEDIA_KIND,
  MEDIA_VISIBILITY,
} = require("../../../../commons/schemas/mediaSchema");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require("../../../../errors/BaseError");
const { MediaInUseError } = require("../../../../errors/MediaInUseError");
const { StorageError } = require("../../../../errors/StorageError");
const {
  MediaUsageService,
} = require("../../../../commons/services/media/media-usage");
const {
  applyCacheHeaders,
} = require("../../../../commons/utilities/cache-headers");
const {
  mediaFileUrl,
} = require("../../../../commons/services/media/media-reference");
const {
  assertBookingDocumentAccess,
  assertInstanceMediaFileAccess,
  assertMediaFileAccess,
  mayUpdateBookingDocument,
} = require("../../../../commons/services/media/media-access");

const logger = bunyan.createLogger({
  name: "media.controller.v2.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

const PATCHABLE_FIELDS = ["title", "altText", "tags", "visibility"];

/**
 * Normalises the tags input, which arrives as an array, a JSON array or a
 * comma separated list depending on the request encoding.
 *
 * @param {*} value - Raw tags input.
 * @returns {string[]|undefined} The parsed tags, undefined if none were sent.
 */
function parseTags(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (raw.startsWith("[")) {
    try {
      return parseTags(JSON.parse(raw));
    } catch {
      throw new BadRequestError("invalid_tags");
    }
  }

  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Validates an optional enum input.
 *
 * @param {*} value - The raw value.
 * @param {Object} allowed - Enum object of allowed values.
 * @param {string} code - Error code for invalid values.
 * @returns {string|undefined} The validated value, undefined if none was sent.
 */
function parseEnum(value, allowed, code) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const values = Object.values(allowed);
  if (!values.includes(value)) {
    throw new BadRequestError(code, { allowed: values });
  }

  return value;
}

/**
 * Media library endpoints, serving both scopes of the library: the media of a
 * tenant and the instance media (§4.9). The handlers are the same for both —
 * who may do what is the routes' (`media.*` against `instanceMedia.*`,
 * authorize spec §3.2), and the absence of `:tenant` is the address of the
 * instance library, nothing more.
 *
 * What the handlers still decide is not a right but a rule of the medium:
 * a booking document follows the receipt rule rather than the library's
 * (`media.bookingDocument`, a second entry of the table asked here, §5), and
 * the visibility `public | intern` of a file stays in the media module,
 * in addition to the reach.
 *
 * Resources are returned as plain JSON without an envelope; URLs are always
 * relative.
 */
class MediaControllerV2 {
  /**
   * The tenant a request addresses; `null` is the instance library, whose
   * media are exactly the media without a tenant.
   *
   * @param {Object} req - Express request.
   * @returns {string|null} The tenant of the request.
   */
  static _tenantId(req) {
    return req.params?.tenant ?? null;
  }

  /**
   * Public representation of a medium. Storage keys stay internal.
   *
   * @param {Object} media - The medium.
   * @returns {Object} The response body.
   */
  static _toResponse(media) {
    return {
      id: media.id,
      tenantId: media.tenantId ?? null,
      kind: media.kind,
      mimeType: media.mimeType,
      size: media.size,
      checksum: media.checksum,
      originalFileName: media.originalFileName,
      title: media.title,
      altText: media.altText,
      tags: media.tags || [],
      visibility: media.visibility,
      uploadedBy: media.uploadedBy ?? null,
      bookingIds: media.bookingIds ?? [],
      storage: { provider: media.storage?.provider },
      variants: (media.variants || []).map((variant) => ({
        name: variant.name,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        size: variant.size,
        checksum: variant.checksum,
      })),
      url: mediaFileUrl(media.id, media.tenantId),
      createdAt: media.createdAt ?? null,
      updatedAt: media.updatedAt ?? null,
    };
  }

  /**
   * The rule a medium follows when its metadata is read: the receipt rule for
   * a booking document, the library's own `media.read` otherwise. The route
   * marker is the door both come through (`media.metadata`), so the rule that
   * applies is decided here, on the principal already loaded (§5).
   *
   * @param {Object} req - Express request.
   * @param {Object} media - The medium.
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertMetadataAccess(req, media) {
    if (media.isBookingDocument()) {
      return await assertBookingDocumentAccess(
        media,
        scopeFor(req, "media", "bookingDocument"),
      );
    }

    if (!withinReach(media, "uploadedBy", scopeFor(req, "media", "read"))) {
      throw new ForbiddenError("forbidden");
    }
  }

  /**
   * The rule a medium follows when its metadata is changed: a booking
   * document follows the update side of the receipt rule, everything else the
   * library's `media.update`.
   *
   * @param {Object} req - Express request.
   * @param {Object} media - The medium.
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertUpdateAccess(req, media) {
    if (media.isBookingDocument()) {
      const allowed = await mayUpdateBookingDocument(
        media,
        scopeFor(req, "media", "updateBookingDocument"),
      );

      if (!allowed) {
        throw new ForbiddenError("forbidden");
      }

      return;
    }

    if (!withinReach(media, "uploadedBy", scopeFor(req, "media", "update"))) {
      throw new ForbiddenError("forbidden");
    }
  }

  /**
   * Access to the file of a medium: what the medium's visibility says, in
   * addition to the reach of the route (§5). A booking document follows the
   * receipt rule; an instance medium has no membership that could narrow it.
   *
   * @param {Object} req - Express request.
   * @param {Object} media - The medium.
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertFileAccess(req, media) {
    if (!MediaControllerV2._tenantId(req)) {
      return assertInstanceMediaFileAccess(media, scopeOf(req));
    }

    return await assertMediaFileAccess(media, {
      file: scopeOf(req),
      document: scopeFor(req, "media", "bookingDocument"),
    });
  }

  /**
   * Loads a medium of the tenant or fails with 404.
   *
   * @param {string} mediaId - Id of the medium.
   * @param {string} tenantId - Id of the tenant.
   * @returns {Promise<Object>} The medium.
   * @throws {NotFoundError}
   */
  static async _requireMedia(mediaId, tenantId) {
    const media = await MediaManager.getMedia(mediaId, tenantId);

    if (!media) {
      throw new NotFoundError("media_not_found", { mediaId });
    }

    return media;
  }

  /**
   * Upload a single file into the media library.
   */
  static async createMedia(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);

    const file = req.files?.file;

    if (!file) {
      throw new BadRequestError("missing_file");
    }

    if (Array.isArray(file)) {
      throw new BadRequestError("multiple_files_not_supported");
    }

    if (!file.name) {
      throw new BadRequestError("missing_file_name");
    }

    const media = await MediaService.createMedia({
      tenantId,
      file,
      metadata: {
        title: req.body?.name,
        altText: req.body?.altText,
        tags: parseTags(req.body?.tags),
        visibility: parseEnum(
          req.body?.visibility,
          MEDIA_VISIBILITY,
          "invalid_visibility",
        ),
      },
      uploadedBy: req.user?.id,
    });

    logger.info(
      { tenantId, mediaId: media.id, userId: req.user?.id },
      "Media uploaded",
    );

    return res.status(201).json(MediaControllerV2._toResponse(media));
  }

  /**
   * List media of a tenant — the backend of the media picker.
   */
  static async getMediaList(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);
    const { page, pageSize, tag, q } = req.query;

    const kind = parseEnum(req.query.kind, MEDIA_KIND, "invalid_kind");
    const requestedVisibility = parseEnum(
      req.query.visibility,
      MEDIA_VISIBILITY,
      "invalid_visibility",
    );

    // How much of the library the reach covers: everything under `any`, the
    // caller's own uploads under `own`.
    const result = await MediaManager.getMediaList({
      tenantId,
      page,
      pageSize,
      kind,
      tag,
      q,
      visibility: requestedVisibility ? [requestedVisibility] : undefined,
      ...ownCondition("uploadedBy", scopeOf(req)),
    });

    return res.status(200).json({
      items: result.items.map(MediaControllerV2._toResponse),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  /**
   * Metadata of a single medium.
   */
  static async getMedia(req, res) {
    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      MediaControllerV2._tenantId(req),
    );

    await MediaControllerV2._assertMetadataAccess(req, media);

    return res.status(200).json(MediaControllerV2._toResponse(media));
  }

  /**
   * Change the metadata of a medium — never its file.
   */
  static async updateMedia(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);

    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaControllerV2._assertUpdateAccess(req, media);

    const updates = {};

    if (req.body?.title !== undefined) {
      updates.title = String(req.body.title);
    }

    if (req.body?.altText !== undefined) {
      updates.altText = String(req.body.altText);
    }

    const tags = parseTags(req.body?.tags);
    if (tags !== undefined) {
      updates.tags = tags;
    }

    const visibility = parseEnum(
      req.body?.visibility,
      MEDIA_VISIBILITY,
      "invalid_visibility",
    );
    // Visibility is meaningless for a booking document — access follows the
    // booking alone. Storing one anyway would suggest a knob that does nothing.
    if (visibility !== undefined && !media.isBookingDocument()) {
      updates.visibility = visibility;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("no_updatable_fields", {
        allowed: PATCHABLE_FIELDS,
      });
    }

    Object.assign(media, updates);
    media.validate();

    const stored = await MediaManager.storeMedia(media, false);

    logger.info(
      { tenantId, mediaId: stored.id, fields: Object.keys(updates) },
      "Media metadata updated",
    );

    return res.status(200).json(MediaControllerV2._toResponse(stored));
  }

  /**
   * Stream the file of a medium: the original, or the variant a `?size=`
   * preset resolves to.
   */
  static async getMediaFile(req, res, next) {
    const tenantId = MediaControllerV2._tenantId(req);
    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaControllerV2._assertFileAccess(req, media);

    const delivery = MediaService.describeDelivery(media, req.query?.size);

    const notModified = applyCacheHeaders(req, res, {
      cacheControl: delivery.cacheControl,
      etag: delivery.etag,
    });

    if (notModified) {
      return res.status(304).end();
    }

    const stream = await MediaService.getStream(media, delivery.key);

    res.setHeader("Content-Type", delivery.contentType);
    res.setHeader("Content-Disposition", delivery.disposition);
    if (delivery.contentLength) {
      res.setHeader("Content-Length", delivery.contentLength);
    }

    stream.on("error", (streamError) => {
      logger.error(
        { err: streamError, tenantId, mediaId: media.id },
        "Error while streaming media file",
      );

      // Nothing was written yet: drop the file headers and let the central
      // error handler answer. Mid-transfer there is no way back — cut the wire.
      if (!res.headersSent) {
        res.removeHeader("Content-Type");
        res.removeHeader("Content-Disposition");
        res.removeHeader("Content-Length");
        res.removeHeader("Cache-Control");
        res.removeHeader("ETag");
        next(
          StorageError.from(streamError, "storage_stream_failed", {
            provider: media.storage?.provider,
          }),
        );
      } else {
        res.destroy();
      }
    });

    req.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  }

  /**
   * The usage proof of a medium: every entity that references it. Read like
   * the metadata — whoever may see a medium may see where it is used.
   */
  static async getMediaUsage(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);
    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaControllerV2._assertMetadataAccess(req, media);

    const usage = await MediaUsageService.findUsage({
      tenantId,
      mediaId: media.id,
    });

    return res.status(200).json(usage);
  }

  /**
   * Delete a medium: blocked while it is in use, otherwise database document
   * first and bytes best-effort. There is no recycle bin.
   */
  static async deleteMedia(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);

    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    // Every booking document the platform writes today is a system receipt.
    // Those are undeletable by hand, for anyone — they only cascade with their
    // booking, so no permission can grant it.
    if (media.isBookingDocument()) {
      throw new ForbiddenError("booking_document_not_deletable", {
        bookingIds: media.bookingIds,
      });
    }

    // The reach of the route already decided who may delete; under `own`
    // only the caller's own upload is theirs to delete.
    if (!withinReach(media, "uploadedBy", scopeOf(req))) {
      throw new ForbiddenError("forbidden");
    }

    const usage = await MediaUsageService.findUsage({
      tenantId,
      mediaId: media.id,
    });

    if (usage.length > 0) {
      throw new MediaInUseError(usage);
    }

    await MediaService.deleteMedia(media);

    logger.info(
      { tenantId, mediaId: media.id, userId: req.user?.id },
      "Media deleted",
    );

    return res.status(204).end();
  }
}

module.exports = MediaControllerV2;
