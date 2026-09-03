const PdfService = require("../../pdf-service/pdf-service");
const {
  BOOKING_DOCUMENT,
  isStorageFailure,
  readBookingDocument,
} = require("../media/booking-documents");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "receipt-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The receipt: rendered for the issuance (`document-issuance.js`), which
 * draws its number, stores it and attaches it, and read back for the
 * download route.
 */
class ReceiptService {
  /**
   * Renders the receipt under its number: one booking, or the group as one
   * aggregated receipt.
   *
   * @param {import("../documents/document-issuance").RenderInput} input
   * @returns {Promise<import("../documents/document-issuance").Rendered>}
   */
  static async render({ tenantId, bookingIds, number, groupBookingId }) {
    const pdf = groupBookingId
      ? await PdfService.generateAggregatedReceipt(tenantId, bookingIds, number)
      : await PdfService.generateSingleReceipt(tenantId, bookingIds[0], number);

    return { name: pdf.name, buffer: pdf.buffer };
  }

  /**
   * The receipt file, as a facade over the media library: receipts written
   * since the media library exists are booking documents, older ones still
   * live in the legacy Nextcloud tree until the media import moves them.
   *
   * @param {string} tenantId - Tenant of the booking.
   * @param {string} receiptName - File name stored on the booking attachment.
   * @param {string} [bookingId] - Booking the receipt belongs to.
   * @returns {Promise<Buffer>} The receipt bytes.
   */
  static async getReceipt(tenantId, receiptName, bookingId) {
    try {
      return await readBookingDocument({
        tenantId,
        bookingId,
        fileName: receiptName,
        type: BOOKING_DOCUMENT.RECEIPT,
      });
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to get receipt", {
          tenantId,
          receiptName,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to retrieve receipt: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }
}

module.exports = ReceiptService;
