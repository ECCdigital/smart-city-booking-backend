const crypto = require("crypto");
const bunyan = require("bunyan");
const { v4: uuidv4 } = require("uuid");

const MediaManager = require("../../data-managers/media-manager");
const { Media } = require("../../entities/media/media");
const { MEDIA_VISIBILITY } = require("../../schemas/mediaSchema");
const { BadRequestError } = require("../../../errors/BaseError");
const { CACHE_POLICY, strongEtag } = require("../../utilities/cache-headers");
const storage = require("../storage");
const { originalKey, variantKey } = require("../storage/media-keys");
const {
  IMAGE_PRESETS,
  PRESET_NAMES,
  VARIANT_MIME_TYPE,
  generateImageVariants,
  presetByName,
} = require("./image-variants");
const { largestMediaLimitBytes, maxBytesForKind } = require("./media-config");
const {
  SVG_MIME_TYPE,
  detectStoredType,
  detectUploadType,
} = require("./media-file-type");

const logger = bunyan.createLogger({
  name: "media-service.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * Reduces a file name to something a `Content-Disposition` header can carry
 * verbatim.
 *
 * @param {string} fileName - The original file name.
 * @returns {string} An ASCII-only file name.
 */
function asciiFileName(fileName) {
  const sanitised = String(fileName || "")
    .replace(/[^\w.\- ]+/g, "_")
    .trim();

  return sanitised || "download";
}

/**
 * Rejects an upload above a byte limit.
 *
 * @param {number} size - Size of the upload in bytes.
 * @param {number} maxBytes - The limit that applies.
 * @param {string} [kind] - Media kind, once it is known.
 * @throws {BadRequestError} When the upload is too large.
 */
function assertWithinLimit(size, maxBytes, kind) {
  if (size > maxBytes) {
    throw new BadRequestError("file_too_large", { size, maxBytes, kind });
  }
}

/**
 * Orchestrates the two halves of a medium: the database record (source of
 * truth) and the bytes in the configured storage.
 */
class MediaService {
  /**
   * Removes bytes written by a failed upload so no half medium is left behind.
   *
   * @param {Object} provider - The storage provider the bytes went to.
   * @param {string[]} keys - Keys written so far.
   * @returns {Promise<void>}
   */
  static async _rollbackUpload(provider, keys) {
    if (keys.length === 0) {
      return;
    }

    try {
      await provider.deleteMany({ keys });
    } catch (error) {
      logger.warn(
        { err: error, keys },
        "Rollback of a failed upload left orphans in storage",
      );
    }
  }

  /**
   * Stores an uploaded file: the type is decided from the content, the size is
   * checked against the limit of that type, images get their variants, and
   * only then do bytes and metadata land. Anything that fails takes the whole
   * upload with it — bytes already written are removed again.
   *
   * @param {Object} params
   * @param {string|null} params.tenantId - Owning tenant, null for instance media.
   * @param {Object} params.file - Upload as delivered by express-fileupload.
   * @param {Object} [params.metadata] - title, altText, tags, visibility.
   * @param {string} [params.uploadedBy] - Id of the uploading user.
   * @param {string} [params.bookingId] - Linked booking, for booking documents.
   * @returns {Promise<Object>} The stored medium.
   * @throws {BadRequestError} On oversized, unsupported or unprocessable files.
   */
  static async createMedia({
    tenantId,
    file,
    metadata = {},
    uploadedBy,
    bookingId,
  }) {
    const data = file.data;

    // The global express-fileupload backstop truncates instead of rejecting
    // when an operator turns `abortOnLimit` off.
    if (file.truncated) {
      throw new BadRequestError("file_too_large");
    }

    // No kind is known yet, so this only rejects what no limit could allow —
    // but it does so before sharp decodes tens of megabytes for nothing.
    assertWithinLimit(data.length, largestMediaLimitBytes());

    const detected = await detectUploadType(data);
    assertWithinLimit(
      data.length,
      maxBytesForKind(detected.kind),
      detected.kind,
    );

    const variants = detected.variants
      ? await generateImageVariants({
          data,
          mimeType: detected.mimeType,
          sourceWidth: detected.image?.width,
        })
      : [];

    const providerName = storage.configuredProviderName();
    const provider = storage.getStorageProvider(providerName);
    const mediaId = uuidv4();

    const media = Media.create({
      id: mediaId,
      tenantId: tenantId ?? null,
      kind: detected.kind,
      mimeType: detected.mimeType,
      size: data.length,
      checksum: crypto.createHash("sha256").update(data).digest("hex"),
      originalFileName: file.name,
      title: metadata.title || file.name,
      altText: metadata.altText || "",
      tags: metadata.tags || [],
      visibility: metadata.visibility || MEDIA_VISIBILITY.PUBLIC,
      uploadedBy: uploadedBy || null,
      bookingId: bookingId || null,
      storage: {
        provider: providerName,
        key: originalKey({
          tenantId: tenantId ?? null,
          mediaId,
          mimeType: detected.mimeType,
          fileName: file.name,
        }),
      },
      variants: variants.map((variant) => ({
        name: variant.name,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        size: variant.size,
        checksum: variant.checksum,
        key: variantKey({
          tenantId: tenantId ?? null,
          mediaId,
          name: variant.name,
          format: variant.format,
        }),
      })),
    });

    return await MediaService._persist({
      provider,
      media,
      payloads: [
        { key: media.storage.key, data, contentType: detected.mimeType },
        ...variants.map((variant, index) => ({
          key: media.variants[index].key,
          data: variant.data,
          contentType: VARIANT_MIME_TYPE,
        })),
      ],
    });
  }

  /**
   * Writes the bytes of a medium and then its database record. Anything that
   * fails takes the whole medium with it — bytes already written are removed
   * again, so no half medium is left behind.
   *
   * @param {Object} params
   * @param {Object} params.provider - Storage provider to write to.
   * @param {Object} params.media - The medium to store.
   * @param {Array<{key: string, data: Buffer, contentType: string}>} params.payloads
   * @returns {Promise<Object>} The stored medium.
   */
  static async _persist({ provider, media, payloads }) {
    const written = [];

    try {
      for (const payload of payloads) {
        await provider.put(payload);
        written.push(payload.key);
      }

      return await MediaManager.storeMedia(media);
    } catch (error) {
      await MediaService._rollbackUpload(provider, written);
      throw error;
    }
  }

  /**
   * Takes a file of the legacy tree into the media library (§4.10). The upload
   * allowlist and the size limits are rules for what may come in, not for what
   * is already there — the import moves the stock as it stands, keeps the place
   * it had as its legacy path and leaves `uploadedBy` empty, because an
   * imported file has no known uploader. Variants follow with `regenerate`.
   *
   * @param {Object} params
   * @param {string|null} params.tenantId - Owning tenant, null for instance media.
   * @param {string} params.legacyPath - The place the file had in the old tree.
   * @param {Object} params.file - `{ name, data }` of the stored file.
   * @param {Object} [params.metadata] - title, tags, visibility.
   * @param {string} [params.bookingId] - Linked booking, for booking documents.
   * @returns {Promise<Object>} The stored medium.
   */
  static async importMedia({
    tenantId,
    legacyPath,
    file,
    metadata = {},
    bookingId,
  }) {
    const data = file.data;
    const detected = await detectStoredType(data, file.name);

    const providerName = storage.configuredProviderName();
    const provider = storage.getStorageProvider(providerName);
    const mediaId = uuidv4();

    const media = Media.create({
      id: mediaId,
      tenantId: tenantId ?? null,
      kind: detected.kind,
      mimeType: detected.mimeType,
      size: data.length,
      checksum: crypto.createHash("sha256").update(data).digest("hex"),
      originalFileName: file.name,
      title: metadata.title || file.name,
      altText: "",
      tags: metadata.tags || [],
      visibility: metadata.visibility || MEDIA_VISIBILITY.PUBLIC,
      uploadedBy: null,
      bookingId: bookingId || null,
      legacyPath,
      storage: {
        provider: providerName,
        key: originalKey({
          tenantId: tenantId ?? null,
          mediaId,
          mimeType: detected.mimeType,
          fileName: file.name,
        }),
      },
      variants: [],
    });

    return await MediaService._persist({
      provider,
      media,
      payloads: [
        { key: media.storage.key, data, contentType: detected.mimeType },
      ],
    });
  }

  /**
   * Regenerates the variants of an image medium — the way stock catches up with
   * a changed preset set (§4.10). The variants are written to the provider the
   * medium lives on, never to the configured one: a medium only ever moves as a
   * whole. Variants that no longer belong to any preset are removed
   * best-effort; whatever survives is what `cleanup` finds later.
   *
   * @param {Object} media - The medium to regenerate.
   * @returns {Promise<{media: Object, added: string[], removed: string[]}>}
   */
  static async regenerateVariants(media) {
    const provider = MediaService.providerFor(media);
    const data = await provider.getBuffer({ key: media.storage.key });

    const detected = await detectStoredType(data, media.originalFileName);

    if (!detected.variants) {
      return { media, added: [], removed: [] };
    }

    const variants = await generateImageVariants({
      data,
      mimeType: detected.mimeType,
      sourceWidth: detected.image?.width,
    });

    const regenerated = variants.map((variant) => ({
      name: variant.name,
      format: variant.format,
      width: variant.width,
      height: variant.height,
      size: variant.size,
      checksum: variant.checksum,
      key: variantKey({
        tenantId: media.tenantId ?? null,
        mediaId: media.id,
        name: variant.name,
        format: variant.format,
      }),
    }));

    const keptKeys = new Set(regenerated.map((variant) => variant.key));
    const removed = (media.variants || [])
      .map((variant) => variant.key)
      .filter((key) => key && !keptKeys.has(key));

    // What the medium already has, by key. A regeneration that produces the
    // same bytes must leave the storage alone — a second run of the command
    // changes nothing.
    const existing = new Map(
      (media.variants || []).map((variant) => [variant.key, variant.checksum]),
    );

    const added = [];

    for (let index = 0; index < regenerated.length; index++) {
      const variant = regenerated[index];

      if (existing.get(variant.key) === variant.checksum) {
        continue;
      }

      await provider.put({
        key: variant.key,
        data: variants[index].data,
        contentType: VARIANT_MIME_TYPE,
      });
      added.push(variant.key);
    }

    if (added.length === 0 && removed.length === 0) {
      return { media, added, removed };
    }

    media.variants = regenerated;
    const stored = await MediaManager.storeMedia(media, false);

    if (removed.length > 0) {
      try {
        await provider.deleteMany({ keys: removed });
      } catch (error) {
        logger.warn(
          { err: error, mediaId: media.id, keys: removed },
          "Superseded variants could not be removed, leaving orphans in storage",
        );
      }
    }

    return { media: stored, added, removed };
  }

  /**
   * Stores a document the platform generated for a booking (receipt, invoice,
   * cancellation) as a booking document medium. `bookingId` is the only thing
   * that sets it apart: access follows the receipt rule, its visibility is
   * meaningless and it never appears in the library listing.
   *
   * @param {Object} params
   * @param {string} params.tenantId - Owning tenant.
   * @param {string} params.bookingId - The booking the document belongs to.
   * @param {Object} params.file - `{ name, data }` of the generated document.
   * @param {string[]} [params.tags] - Tags, e.g. `["invoice"]`.
   * @returns {Promise<Object>} The stored medium.
   */
  static async createBookingDocument({ tenantId, bookingId, file, tags = [] }) {
    if (!bookingId) {
      throw new BadRequestError("missing_booking_id");
    }

    return await MediaService.createMedia({
      tenantId,
      file,
      bookingId,
      metadata: {
        title: file.name,
        tags,
        // Meaningless for booking documents, but never the public default.
        visibility: MEDIA_VISIBILITY.INTERN,
      },
    });
  }

  /**
   * Resolves the provider a medium's bytes actually live on — reading always
   * follows the medium, never the instance configuration.
   *
   * @param {Object} media - The medium.
   * @returns {import("../storage/storage-provider").StorageProvider}
   */
  static providerFor(media) {
    return storage.getStorageProvider(media?.storage?.provider);
  }

  /**
   * Picks the variant a requested preset is served with: the variant itself if
   * it exists, otherwise the next larger one, otherwise the original. A preset
   * choice never produces a 404.
   *
   * @param {Object} media - The medium.
   * @param {string} [requestedSize] - Preset name from `?size=`.
   * @returns {Object|null} The variant to serve, null for the original.
   * @throws {BadRequestError} When the preset name is unknown.
   */
  static resolveVariant(media, requestedSize) {
    if (!requestedSize) {
      return null;
    }

    const preset = presetByName(requestedSize);

    if (!preset) {
      throw new BadRequestError("invalid_size", { allowed: PRESET_NAMES });
    }

    const available = new Map(
      (media.variants || []).map((variant) => [variant.name, variant]),
    );

    const ladder = IMAGE_PRESETS.filter(
      (candidate) => candidate.width >= preset.width,
    );

    for (const candidate of ladder) {
      if (available.has(candidate.name)) {
        return available.get(candidate.name);
      }
    }

    return null;
  }

  /**
   * Everything the binary endpoint needs to answer a request: which bytes to
   * read and how they may be cached (§4.6 of the media spec).
   *
   * @param {Object} media - The medium.
   * @param {string} [requestedSize] - Preset name from `?size=`.
   * @returns {Object} Key, headers and the resolved variant.
   * @throws {BadRequestError} When the preset name is unknown.
   */
  static describeDelivery(media, requestedSize) {
    const variant = MediaService.resolveVariant(media, requestedSize);

    // A booking document is never cached anywhere; its visibility is
    // meaningless, access follows the booking.
    const isBookingDocument = Boolean(media.bookingId);
    const checksum = variant ? variant.checksum : media.checksum;

    let cacheControl = CACHE_POLICY.PUBLIC_IMMUTABLE;
    let etag = null;

    if (isBookingDocument) {
      cacheControl = CACHE_POLICY.PRIVATE_NO_STORE;
    } else if (media.visibility !== MEDIA_VISIBILITY.PUBLIC) {
      cacheControl = CACHE_POLICY.PRIVATE_NO_CACHE;
      etag = strongEtag(checksum);
    } else if (requestedSize) {
      // Only the bare original is immutable. A preset URL can start resolving
      // to a different variant — a degradation that a later regeneration
      // fills in, for one — so it always stays revalidatable.
      cacheControl = CACHE_POLICY.PUBLIC_REVALIDATE;
      etag = strongEtag(checksum);
    }

    return {
      variant,
      key: variant ? variant.key : media.storage.key,
      contentType: variant
        ? VARIANT_MIME_TYPE
        : media.mimeType || "application/octet-stream",
      contentLength: variant ? variant.size : media.size,
      // Serving an SVG inline would run its script in our origin; the original
      // of a vector medium is a download, its variants are the rendered image.
      disposition:
        !variant && media.mimeType === SVG_MIME_TYPE
          ? `attachment; filename="${asciiFileName(media.originalFileName)}"`
          : "inline",
      cacheControl,
      etag,
    };
  }

  /**
   * Opens a readable stream for a key of a medium.
   *
   * @param {Object} media - The medium.
   * @param {string} [key] - Key to read, defaults to the original.
   * @returns {Promise<import("node:stream").Readable>}
   */
  static async getStream(media, key) {
    return await MediaService.providerFor(media).getStream({
      key: key || media.storage.key,
    });
  }

  /**
   * Reads the full bytes of a medium — for callers that hand a file on as a
   * buffer instead of streaming it (mail attachments, document downloads).
   *
   * @param {Object} media - The medium.
   * @returns {Promise<Buffer>}
   */
  static async getBuffer(media) {
    return await MediaService.providerFor(media).getBuffer({
      key: media.storage.key,
    });
  }

  /**
   * Deletes a medium: database document first, bytes best-effort afterwards.
   * A failed byte removal leaves an orphan in the storage — accepted, the
   * media CLI cleans up.
   *
   * @param {Object} media - The medium to delete.
   * @returns {Promise<boolean>} True if the document was removed.
   */
  static async deleteMedia(media) {
    const removed = await MediaManager.removeMedia(media.id, media.tenantId);

    const keys = [
      media.storage?.key,
      ...(media.variants || []).map((variant) => variant.key),
    ].filter(Boolean);

    try {
      await MediaService.providerFor(media).deleteMany({ keys });
    } catch (error) {
      logger.warn(
        { err: error, mediaId: media.id, keys },
        "Media bytes could not be removed, leaving orphans in storage",
      );
    }

    return removed;
  }
}

module.exports = MediaService;
