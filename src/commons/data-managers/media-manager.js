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
    // Normal media carry no booking references at all, so `null` (which also
    // matches an absent field) is the whole non-document stock.
    const filter = { tenantId: tenantId ?? null, bookingIds: null };

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
   * Find an imported medium by the place its bytes had in the legacy tree —
   * the lookup behind the permanent resolver route `GET /files/get?name=`
   * (§4.10). Only imported media carry a legacy path.
   *
   * @param {string|null} tenantId - Tenant ID (null for instance media).
   * @param {string} legacyPath - Normalised legacy path.
   * @returns {Promise<Object|null>} The medium or null.
   */
  static async getMediaByLegacyPath(tenantId, legacyPath) {
    if (!legacyPath) {
      return null;
    }

    const rawMedia = await MediaModel.findOne({
      tenantId: tenantId ?? null,
      legacyPath,
    });

    return rawMedia ? rawMedia.toEntity() : null;
  }

  /**
   * Every medium matching a filter, unpaginated — the media CLI walks the whole
   * stock (regenerate, verify, cleanup) and has no page to show it on.
   *
   * @param {Object} [filter] - Mongo filter, e.g. `{ kind: "image" }`.
   * @returns {Promise<Object[]>} The matching media.
   */
  static async getAllMedia(filter = {}) {
    const rawMedia = await MediaModel.find(filter).sort({ createdAt: 1 });

    return rawMedia.map((raw) => raw.toEntity());
  }

  /**
   * How many media match a filter — for the media CLI, which reports what a
   * scope holds without needing the documents themselves.
   *
   * @param {Object} [filter] - Mongo filter, e.g. `{ tenantId: "t1" }`.
   * @returns {Promise<number>} Number of matching media.
   */
  static async countMedia(filter = {}) {
    return await MediaModel.countDocuments(filter);
  }

  /**
   * How many media the import brought over. Zero means the media import has not
   * run on this installation — the boot warning and the legacy fallback of the
   * resolver route hang off that (§4.10).
   *
   * @returns {Promise<number>} Number of imported media.
   */
  static async countImportedMedia() {
    return await MediaModel.countDocuments({ legacyPath: { $ne: null } });
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

    const filter = {
      tenantId: tenantId ?? null,
      originalFileName: fileName,
    };

    // Without a booking the name alone decides, so a caller authorised for
    // one booking could reach another one's document — always scope when the
    // booking is known.
    if (bookingId) {
      filter.bookingIds = bookingId;
    } else {
      filter["bookingIds.0"] = { $exists: true };
    }

    const rawMedia = await MediaModel.findOne(filter).sort({ createdAt: -1 });

    return rawMedia ? rawMedia.toEntity() : null;
  }

  /**
   * All documents of one booking — the media that cascade when the booking is
   * removed, system receipts included.
   *
   * @param {string} tenantId - Tenant ID.
   * @param {string} bookingId - The booking the documents belong to.
   * @returns {Promise<Object[]>} The booking documents.
   */
  static async getBookingDocuments(tenantId, bookingId) {
    if (!bookingId) {
      return [];
    }

    const rawMedia = await MediaModel.find({
      tenantId: tenantId ?? null,
      bookingIds: bookingId,
    });

    return rawMedia.map((raw) => raw.toEntity());
  }

  /**
   * Drops one booking reference from a medium in a single atomic update, so
   * concurrent deletions of bookings sharing an aggregated document can never
   * lose each other's write. The caller decides what to do with a medium whose
   * reference list ran empty.
   *
   * @param {string} mediaId - Unique ID of the medium.
   * @param {string} tenantId - Tenant ID.
   * @param {string} bookingId - The booking reference to drop.
   * @returns {Promise<Object|null>} The updated medium or null.
   */
  static async removeBookingReference(mediaId, tenantId, bookingId) {
    if (!mediaId || !bookingId) {
      throw new Error("mediaId and bookingId are required.");
    }

    const updated = await MediaModel.findOneAndUpdate(
      { id: mediaId, tenantId: tenantId ?? null },
      { $pull: { bookingIds: bookingId } },
      { new: true },
    );

    return updated ? updated.toEntity() : null;
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
   * Flip the storage provider of a medium — a targeted update, so a
   * relocation running during operation never writes back the stale document
   * it fetched at the start of its run.
   *
   * @param {string} mediaId - Unique ID of the medium.
   * @param {string|null} tenantId - Tenant ID, null for instance media.
   * @param {string} provider - The provider the medium's bytes now live on.
   * @returns {Promise<void>}
   */
  static async setStorageProvider(mediaId, tenantId, provider) {
    if (!mediaId) {
      throw new Error("mediaId is required.");
    }

    const result = await MediaModel.updateOne(
      { id: mediaId, tenantId: tenantId ?? null },
      { $set: { "storage.provider": provider } },
      { runValidators: true },
    );

    if (result.matchedCount === 0) {
      throw new Error("Media not found for update.");
    }
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
