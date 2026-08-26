const crypto = require("crypto");
const bunyan = require("bunyan");
const { v4: uuidv4 } = require("uuid");

const MediaManager = require("../../data-managers/media-manager");
const { Media } = require("../../entities/media/media");
const { MEDIA_KIND } = require("../../schemas/mediaSchema");
const storage = require("../storage");
const { originalKey } = require("../storage/media-keys");

const logger = bunyan.createLogger({
  name: "media-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Orchestrates the two halves of a medium: the database record (source of
 * truth) and the bytes in the configured storage.
 */
class MediaService {
  /**
   * Derives the media kind from a MIME type.
   *
   * @param {string} mimeType - MIME type of the file.
   * @returns {string} `image` or `document`
   */
  static kindForMimeType(mimeType) {
    return String(mimeType || "").startsWith("image/")
      ? MEDIA_KIND.IMAGE
      : MEDIA_KIND.DOCUMENT;
  }

  /**
   * Stores an uploaded file: bytes go to the configured provider, metadata
   * becomes a medium. Fails as a whole if the bytes cannot be written.
   *
   * @param {Object} params
   * @param {string|null} params.tenantId - Owning tenant, null for instance media.
   * @param {Object} params.file - Upload as delivered by express-fileupload.
   * @param {Object} [params.metadata] - title, altText, tags, visibility.
   * @param {string} [params.uploadedBy] - Id of the uploading user.
   * @returns {Promise<Object>} The stored medium.
   */
  static async createMedia({ tenantId, file, metadata = {}, uploadedBy }) {
    const providerName = storage.configuredProviderName();
    const provider = storage.getStorageProvider(providerName);

    const mimeType = file.mimetype || "application/octet-stream";
    const data = file.data;
    const mediaId = uuidv4();

    const media = Media.create({
      id: mediaId,
      tenantId: tenantId ?? null,
      kind: MediaService.kindForMimeType(mimeType),
      mimeType,
      size: data?.length ?? file.size ?? 0,
      checksum: crypto.createHash("sha256").update(data).digest("hex"),
      originalFileName: file.name,
      title: metadata.title || file.name,
      altText: metadata.altText || "",
      tags: metadata.tags || [],
      visibility: metadata.visibility || Media.VISIBILITY.PUBLIC,
      uploadedBy: uploadedBy || null,
      storage: {
        provider: providerName,
        key: originalKey({
          tenantId: tenantId ?? null,
          mediaId,
          mimeType,
          fileName: file.name,
        }),
      },
    });

    await provider.put({
      key: media.storage.key,
      data,
      contentType: mimeType,
    });

    return await MediaManager.storeMedia(media);
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
   * Opens a readable stream for the original file of a medium.
   *
   * @param {Object} media - The medium.
   * @returns {Promise<import("node:stream").Readable>}
   */
  static async getOriginalStream(media) {
    return await MediaService.providerFor(media).getStream({
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
