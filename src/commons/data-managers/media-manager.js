const MediaModel = require("./models/mediaModel");
const { escapeRegex } = require("../utilities/regex-utils");

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Data Manager for media objects.
 */
class MediaManager {
  /**
   * Get a specific medium of a tenant.
   *
   * @param {string} mediaId - Unique ID of the medium.
   * @param {string} tenantId - Tenant ID.
   * @returns {Promise<Object|null>} The medium or null.
   */
  static async getMedia(mediaId, tenantId) {
    if (!mediaId) {
      throw new Error("mediaId is required.");
    }

    const rawMedia = await MediaModel.findOne({
      id: mediaId,
      tenantId: tenantId ?? null,
    });

    return rawMedia ? rawMedia.toEntity() : null;
  }

  /**
   * List media of a tenant, paginated and filtered.
   *
   * @param {Object} params
   * @param {string} params.tenantId - Tenant ID (null for instance media).
   * @param {number} [params.page] - 1-based page number.
   * @param {number} [params.pageSize] - Page size, capped at 100.
   * @param {string} [params.kind] - Filter by `image` or `document`.
   * @param {string} [params.tag] - Filter by a single tag.
   * @param {string} [params.q] - Free-text filter on title and file name.
   * @param {string[]} [params.visibility] - Allowed visibilities.
   * @param {string} [params.uploadedBy] - Restrict to the media of one uploader.
   * @returns {Promise<{ items: Object[], total: number, page: number, pageSize: number }>}
   */
  static async getMediaList({
    tenantId,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    kind,
    tag,
    q,
    visibility,
    uploadedBy,
  } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE),
    );

    // Booking documents are never part of the library listing or the picker.
    const filter = { tenantId: tenantId ?? null, bookingId: null };

    if (uploadedBy) {
      filter.uploadedBy = uploadedBy;
    }

    if (kind) {
      filter.kind = kind;
    }

    if (tag) {
      filter.tags = tag;
    }

    // An empty list is meaningful: the caller may read no visibility at all.
    if (Array.isArray(visibility)) {
      filter.visibility = { $in: visibility };
    }

    if (q) {
      const term = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { title: term },
        { originalFileName: term },
        { altText: term },
      ];
    }

    const [rawMedia, total] = await Promise.all([
      MediaModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize),
      MediaModel.countDocuments(filter),
    ]);

    return {
      items: rawMedia.map((raw) => raw.toEntity()),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  /**
   * Find the booking document a download route asks for by file name. The
   * booking routes address their documents by the name stored in the booking
   * attachment, not by media id.
   *
   * @param {string} tenantId - Tenant ID.
   * @param {string} fileName - Original file name of the document.
   * @param {string} [bookingId] - Restrict to the documents of one booking.
   * @returns {Promise<Object|null>} The newest matching medium or null.
   */
  static async getBookingDocumentByFileName(tenantId, fileName, bookingId) {
    if (!fileName) {
      return null;
    }

    const rawMedia = await MediaModel.findOne({
      tenantId: tenantId ?? null,
      // Without a booking the name alone decides, so a caller authorised for
      // one booking could reach another one's document — always scope when the
      // booking is known.
      bookingId: bookingId ? bookingId : { $ne: null },
      originalFileName: fileName,
    }).sort({ createdAt: -1 });

    return rawMedia ? rawMedia.toEntity() : null;
  }

  /**
   * Insert or update a medium.
   *
   * @param {Object} media - The medium to store.
   * @param {boolean} [upsert] - Whether to insert when missing.
   * @returns {Promise<Object>} The stored medium.
   */
  static async storeMedia(media, upsert = true) {
    if (!media || typeof media !== "object") {
      throw new Error("media object is required.");
    }

    if (!media.id) {
      throw new Error("media.id is required.");
    }

    const updated = await MediaModel.findOneAndUpdate(
      { id: media.id, tenantId: media.tenantId ?? null },
      media,
      { upsert, new: true, runValidators: true },
    );

    if (!updated) {
      throw new Error("Media not found for update.");
    }

    return updated.toEntity();
  }

  /**
   * Remove a medium from the database. Bytes are removed separately.
   *
   * @param {string} mediaId - Unique ID of the medium.
   * @param {string} tenantId - Tenant ID.
   * @returns {Promise<boolean>} True if a document was removed.
   */
  static async removeMedia(mediaId, tenantId) {
    if (!mediaId) {
      throw new Error("mediaId is required.");
    }

    const result = await MediaModel.deleteOne({
      id: mediaId,
      tenantId: tenantId ?? null,
    });

    return result.deletedCount > 0;
  }
}

module.exports = MediaManager;
