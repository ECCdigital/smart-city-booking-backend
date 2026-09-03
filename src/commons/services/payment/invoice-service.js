const PdfService = require("../../pdf-service/pdf-service");
const {
  BOOKING_DOCUMENT,
  isStorageFailure,
  readBookingDocument,
} = require("../media/booking-documents");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invoice-service.js",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * The invoice: rendered for the issuance (`document-issuance.js`), which
 * draws its number, stores it and attaches it, and read back for the
 * download route.
 */
class InvoiceService {
  /**
   * Renders the invoice under its number: one booking, or the group as one
   * aggregated invoice.
   *
   * @param {import("../documents/document-issuance").RenderInput} input
   * @returns {Promise<import("../documents/document-issuance").Rendered>}
   */
  static async render({
    tenantId,
    bookingIds,
    bookings,
    number,
    groupBookingId,
  }) {
    const pdf = groupBookingId
      ? await PdfService.generateAggregatedInvoice(
          tenantId,
          bookingIds,
          number,
          {
            groupBookingId,
            bookings,
          },
        )
      : await PdfService.generateSingleInvoice(tenantId, bookingIds[0], number);

    return { name: pdf.name, buffer: pdf.buffer };
  }

  /**
   * The invoice file, as a facade over the media library: invoices written
   * since the media library exists are booking documents, older ones still
   * live in the legacy Nextcloud tree until the media import moves them.
   *
   * @param {string} tenantId - Tenant of the booking.
   * @param {string} invoiceName - File name stored on the booking attachment.
   * @param {string} [bookingId] - Booking the invoice belongs to.
   * @returns {Promise<Buffer>} The invoice bytes.
   */
  static async getInvoice(tenantId, invoiceName, bookingId) {
    try {
      return await readBookingDocument({
        tenantId,
        bookingId,
        fileName: invoiceName,
        type: BOOKING_DOCUMENT.INVOICE,
      });
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to get invoice", {
          tenantId,
          invoiceName,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to retrieve invoice: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }
}

module.exports = InvoiceService;
