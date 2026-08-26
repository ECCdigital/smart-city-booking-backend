const bunyan = require("bunyan");

const MediaManager = require("../../../../commons/data-managers/media-manager");
const MediaService = require("../../../../commons/services/media/media-service");
const MembershipManager = require("../../../../commons/data-managers/membership-manager");
const PermissionService = require("../../../../commons/services/permission-service");
const {
  MEDIA_KIND,
  MEDIA_VISIBILITY,
} = require("../../../../commons/schemas/mediaSchema");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} = require("../../../../errors/BaseError");
const { StorageError } = require("../../../../errors/StorageError");

const logger = bunyan.createLogger({
  name: "media.controller.v2.js",
  level: process.env.LOG_LEVEL,
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
 * Media library endpoints. Resources are returned as plain JSON without an
 * envelope; URLs are always relative.
 */
class MediaControllerV2 {
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
      bookingId: media.bookingId ?? null,
      storage: { provider: media.storage?.provider },
      variants: (media.variants || []).map((variant) => ({
        name: variant.name,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        size: variant.size,
        checksum: variant.checksum,
      })),
      // Instance media (no tenant) get their own delivery route with B6.
      url: media.tenantId
        ? `/api/v2/${media.tenantId}/media/${media.id}/file`
        : null,
      createdAt: media.createdAt ?? null,
      updatedAt: media.updatedAt ?? null,
    };
  }

  /**
   * Whether the user is an active member of the tenant. `intern` media
   * require membership — being signed in anywhere is not enough.
   *
   * @param {string} userId - Id of the user.
   * @param {string} tenantId - Id of the tenant.
   * @returns {Promise<boolean>}
   */
  static async _hasActiveMembership(userId, tenantId) {
    if (!userId) {
      return false;
    }

    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantId,
      userId,
    );

    return membership?.status === "active";
  }

  /**
   * Write access during the tracer: the tenant owner only. The `manageMedia`
   * role group replaces this check in B3.
   *
   * @param {Object} req - Express request.
   * @param {string} tenantId - Id of the tenant.
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertWriteAccess(req, tenantId) {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedError("unauthorized");
    }

    if (!(await PermissionService._isTenantOwner(userId, tenantId))) {
      throw new ForbiddenError("forbidden");
    }
  }

  /**
   * Read access: `public` media are readable anonymously, `intern` media
   * require an active membership in the owning tenant.
   *
   * @param {Object} req - Express request.
   * @param {Object} media - The medium.
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static async _assertReadAccess(req, media) {
    if (media.isPublic()) {
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("unauthorized");
    }

    if (
      !(await MediaControllerV2._hasActiveMembership(userId, media.tenantId))
    ) {
      throw new ForbiddenError("forbidden");
    }
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
    const tenantId = req.params.tenant;
    await MediaControllerV2._assertWriteAccess(req, tenantId);

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
    const tenantId = req.params.tenant;
    const { page, pageSize, tag, q } = req.query;

    const kind = parseEnum(req.query.kind, MEDIA_KIND, "invalid_kind");
    const requestedVisibility = parseEnum(
      req.query.visibility,
      MEDIA_VISIBILITY,
      "invalid_visibility",
    );

    const mayReadIntern = await MediaControllerV2._hasActiveMembership(
      req.user?.id,
      tenantId,
    );

    const readable = mayReadIntern
      ? Object.values(MEDIA_VISIBILITY)
      : [MEDIA_VISIBILITY.PUBLIC];

    const visibility = requestedVisibility
      ? readable.filter((value) => value === requestedVisibility)
      : readable;

    const result = await MediaManager.getMediaList({
      tenantId,
      page,
      pageSize,
      kind,
      tag,
      q,
      visibility,
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
    const tenantId = req.params.tenant;
    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaControllerV2._assertReadAccess(req, media);

    return res.status(200).json(MediaControllerV2._toResponse(media));
  }

  /**
   * Change the metadata of a medium — never its file.
   */
  static async updateMedia(req, res) {
    const tenantId = req.params.tenant;
    await MediaControllerV2._assertWriteAccess(req, tenantId);

    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
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
    if (visibility !== undefined) {
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
   * Stream the original file of a medium.
   */
  static async getMediaFile(req, res, next) {
    const tenantId = req.params.tenant;
    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaControllerV2._assertReadAccess(req, media);

    const stream = await MediaService.getOriginalStream(media);

    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    if (media.size) {
      res.setHeader("Content-Length", media.size);
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
   * Delete a medium: database document first, bytes best-effort.
   */
  static async deleteMedia(req, res) {
    const tenantId = req.params.tenant;
    await MediaControllerV2._assertWriteAccess(req, tenantId);

    const media = await MediaControllerV2._requireMedia(
      req.params.id,
      tenantId,
    );

    await MediaService.deleteMedia(media);

    logger.info(
      { tenantId, mediaId: media.id, userId: req.user?.id },
      "Media deleted",
    );

    return res.status(204).end();
  }
}

module.exports = MediaControllerV2;
