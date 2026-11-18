const PdfService = require("../../pdf-service/pdf-service");
const {
  BOOKING_DOCUMENT,
  isStorageFailure,
  readBookingDocument,
} = require("../media/booking-documents");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "withdrawal-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The withdrawal receipt (glossary "Widerrufbeleg"): rendered for the
 * issuance (`document-issuance.js`), which draws its number, stores it and
 * attaches it, and read back for the download route. One booking only - a
 * withdrawal is accepted per booking.
 */
class WithdrawalService {
  /**
   * Renders the withdrawal receipt under its number against the document
   * the withdrawal annuls - the latest invoice, else the latest receipt, of
   * the booking, where there is one - with the refund audit of the
   * withdrawal (`options.refundCalculation`) and whether the booking was
   * paid (`options.alreadyPaid`). The attachment's `timeCreated` is the
   * moment of the withdrawal.
   *
   * @param {import("../documents/document-issuance").RenderInput} input
   * @returns {Promise<import("../documents/document-issuance").Rendered>}
   */
  static async render({
    tenantId,
    bookingIds,
    bookings,
    number,
    options = {},
  }) {
    const booking = bookings[0];
    const original =
      _findLatestAttachment(booking, "invoice") ||
      _findLatestAttachment(booking, "receipt");
    const originalInvoiceNumber = original
      ? `${original.invoiceId || original.receiptId}-${original.revision}`
      : null;

    const pdf = await PdfService.generateWithdrawalReceipt(
      tenantId,
      bookingIds[0],
      number,
      originalInvoiceNumber,
      { ...options, originalInvoiceDate: original?.timeCreated },
    );

    const withdrawnAt = options.refundCalculation?.cancelledAt;
    return {
      name: pdf.name,
      buffer: pdf.buffer,
      attachmentFields:
        withdrawnAt !== undefined ? { timeCreated: withdrawnAt } : {},
    };
  }

  /**
   * The withdrawal receipt file from the media library.
   *
   * @param {string} tenantId - Tenant of the booking.
   * @param {string} withdrawalName - File name stored on the attachment.
   * @param {string} [bookingId] - Booking the receipt belongs to.
   * @returns {Promise<Buffer>} The receipt bytes.
   */
  static async getWithdrawal(tenantId, withdrawalName, bookingId) {
    try {
      return await readBookingDocument({
        tenantId,
        bookingId,
        fileName: withdrawalName,
        type: BOOKING_DOCUMENT.WITHDRAWAL,
      });
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to get withdrawal receipt", {
          tenantId,
          withdrawalName,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to retrieve withdrawal receipt: storage is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }
}

module.exports = WithdrawalService;

function _findLatestAttachment(booking, type) {
  const attachments = booking.attachments?.filter((a) => a.type === type) || [];
  if (attachments.length === 0) return null;

  return attachments.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
}
