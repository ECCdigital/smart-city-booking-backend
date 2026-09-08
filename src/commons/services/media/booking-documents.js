const MediaManager = require("../../data-managers/media-manager");
const MediaService = require("./media-service");
const { NextcloudManager } = require("../../data-managers/file-manager");

/**
 * The three documents the platform writes for a booking. `tag` labels the
 * medium in the library, `legacyFolder` is where the pre-media-library file
 * still lies until the media import moves it.
 */
const BOOKING_DOCUMENT = Object.freeze({
  RECEIPT: { tag: "receipt", legacyFolder: "receipts" },
  INVOICE: { tag: "invoice", legacyFolder: "invoices" },
  CANCELLATION: { tag: "cancellation", legacyFolder: "cancellations" },
});

/**
 * Whether a failure came from a storage backend rather than from the request.
 * Both the media storage and the legacy Nextcloud path can raise one.
 *
 * @param {Error} error - The caught error.
 * @returns {boolean}
 */
function isStorageFailure(error) {
  return Boolean(error?.isNextcloudError || error?.isStorageError);
}

/**
 * Stores a generated document as a booking document medium — one medium with
 * one byte copy, whatever the number of bookings. An aggregated document
 * carries every booking of the group as a reference, so every booking owner
 * reaches the same medium under the receipt rule (§4.7).
 *
 * @param {Object} params
 * @param {string} params.tenantId - Tenant of the bookings.
 * @param {string[]} params.bookingIds - Bookings the document belongs to.
 * @param {Object} params.file - `{ name, data }` of the generated document.
 * @param {Object} params.type - One of {@link BOOKING_DOCUMENT}.
 * @returns {Promise<void>}
 */
async function storeBookingDocument({ tenantId, bookingIds, file, type }) {
  await MediaService.createBookingDocument({
    tenantId,
    bookingIds,
    file,
    tags: [type.tag],
  });
}

/**
 * Detaches a removed booking from its documents — system receipts included.
 * Booking documents have no life of their own: each one loses the reference of
 * the removed booking, and with its last reference the medium itself goes
 * (§4.7), on the same database-first, bytes-best-effort path as a manual
 * delete. A shared aggregated document survives as long as any of its bookings
 * does.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Tenant of the booking.
 * @param {string} params.bookingId - The booking being removed.
 * @returns {Promise<number>} How many documents lost the booking.
 */
async function deleteBookingDocuments({ tenantId, bookingId }) {
  const documents = await MediaManager.getBookingDocuments(tenantId, bookingId);

  for (const document of documents) {
    // One atomic pull per document — concurrent deletions of bookings sharing
    // an aggregated document must not lose each other's update.
    const updated = await MediaManager.removeBookingReference(
      document.id,
      tenantId,
      bookingId,
    );

    if (updated && (updated.bookingIds || []).length === 0) {
      await MediaService.deleteMedia(updated);
    }
  }

  return documents.length;
}

/**
 * Reads a booking document: the medium if the library holds it, otherwise the
 * legacy Nextcloud tree, which the media import empties later.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Tenant of the booking.
 * @param {string} [params.bookingId] - Booking the document belongs to.
 * @param {string} params.fileName - File name from the booking attachment.
 * @param {Object} params.type - One of {@link BOOKING_DOCUMENT}.
 * @returns {Promise<Buffer>} The document bytes.
 */
async function readBookingDocument({ tenantId, bookingId, fileName, type }) {
  const media = await MediaManager.getBookingDocumentByFileName(
    tenantId,
    fileName,
    bookingId,
  );

  if (media) {
    return await MediaService.getBuffer(media);
  }

  return await NextcloudManager.getFile({
    tenant: tenantId,
    subFolder: type.legacyFolder,
    filename: fileName,
  });
}

module.exports = {
  BOOKING_DOCUMENT,
  deleteBookingDocuments,
  isStorageFailure,
  readBookingDocument,
  storeBookingDocument,
};
