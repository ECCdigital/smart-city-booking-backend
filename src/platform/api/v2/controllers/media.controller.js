const bunyan = require("bunyan");

const MediaManager = require("../../../../commons/data-managers/media-manager");
const MediaService = require("../../../../commons/services/media/media-service");
const {
  reachesOf,
  scopeOf,
} = require("../../../../commons/services/authorization");
const {
  MEDIA_KIND,
  MEDIA_VISIBILITY,
} = require("../../../../commons/schemas/mediaSchema");
const { BadRequestError } = require("../../../../errors/BaseError");
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
const MediaRights = require("../../../../commons/services/media/media-rights");

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
 * who may do what is the routes' (`media.*` against `instanceMedia.*`), and the absence of `:tenant` is the address of the
 * instance library, nothing more.
 *
 * The handlers decide nothing about rights: each route hands the reaches
 * its marker decided (`reachesOf(req)`) to one verb of the media rights,
 * which loads the medium and picks the rule it follows - the library's, the
 * receipt rule of a booking document, the visibility of a file - or throws
 * the refusal.
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
      width: media.width ?? null,
      height: media.height ?? null,
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

    // How much of the library the reach covers - everything under `any`, the
    // caller's own uploads under `own` - is the manager's to apply.
    const result = await MediaManager.getMediaList(
      {
        tenantId,
        page,
        pageSize,
        kind,
        tag,
        q,
        visibility: requestedVisibility ? [requestedVisibility] : undefined,
      },
      scopeOf(req),
    );

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
    const media = await MediaRights.readable(
      req.params.id,
      MediaControllerV2._tenantId(req),
      reachesOf(req),
    );

    return res.status(200).json(MediaControllerV2._toResponse(media));
  }

  /**
   * Change the metadata of a medium — never its file.
   */
  static async updateMedia(req, res) {
    const tenantId = MediaControllerV2._tenantId(req);

    const media = await MediaRights.updatable(
      req.params.id,
      tenantId,
      reachesOf(req),
    );

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

    // The branding and the Hero are painted for anonymous visitors, so a
    // medium one of them shows cannot turn internal: the page would simply
    // stop loading it. Refused with the usage proof of those sites, the same
    // body a blocked deletion answers.
    if (updates.visibility === MEDIA_VISIBILITY.INTERN && media.isPublic()) {
      const publicUsage = await MediaUsageService.findPublicUsage({
        mediaId: media.id,
      });

      if (publicUsage.length > 0) {
        throw new MediaInUseError(publicUsage);
      }
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
    const media = await MediaRights.fileReadable(
      req.params.id,
      tenantId,
      reachesOf(req),
    );

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
    const media = await MediaRights.readable(
      req.params.id,
      tenantId,
      reachesOf(req),
    );

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

    // Out of reach is not there (404); a booking document is a system
    // receipt nobody deletes by hand (403) - it cascades with its booking.
    const media = await MediaRights.deletable(
      req.params.id,
      tenantId,
      reachesOf(req),
    );

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
