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
 * Stores a generated document as a booking document medium — one per booking.
 * An aggregated document is attached to every booking of the group, so every
 * booking owner has to reach it under the receipt rule; a single medium could
 * only ever carry one `bookingId`.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Tenant of the bookings.
 * @param {string[]} params.bookingIds - Bookings the document belongs to.
 * @param {Object} params.file - `{ name, data }` of the generated document.
 * @param {Object} params.type - One of {@link BOOKING_DOCUMENT}.
 * @returns {Promise<void>}
 */
async function storeBookingDocument({ tenantId, bookingIds, file, type }) {
  for (const bookingId of bookingIds) {
    await MediaService.createBookingDocument({
      tenantId,
      bookingId,
      file,
      tags: [type.tag],
    });
  }
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
  isStorageFailure,
  readBookingDocument,
  storeBookingDocument,
};
