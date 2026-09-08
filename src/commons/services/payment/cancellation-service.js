const PdfService = require("../../pdf-service/pdf-service");
const {
  BOOKING_DOCUMENT,
  isStorageFailure,
  readBookingDocument,
} = require("../media/booking-documents");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "cancellation-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The cancellation document: rendered for the issuance
 * (`document-issuance.js`), which draws its number, stores it and attaches
 * it, and read back for the download route.
 */
class CancellationService {
  /**
   * Renders the cancellation under its number against the document it
   * cancels - the latest invoice, else the latest receipt, of the (first)
   * booking - with the refund calculation the caller passes in `options`
   * (`refundCalculation` for one booking, `refundCalculations` with a
   * `bookingId` each for the group; `alreadyPaid`, `cancellationReason`,
   * `bankDetails`, and `originalInvoiceNumber`/`originalInvoiceDate` to
   * override the reference).
   *
   * The attachment of each booking carries its refund audit and the
   * reference to the cancelled document; `timeCreated` is the moment of the
   * cancellation where one is known.
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
    options = {},
  }) {
    const reference = bookings[0];
    const latestInvoice = _findLatestAttachment(reference, "invoice");
    const latestReceipt = _findLatestAttachment(reference, "receipt");

    const originalInvoiceNumber =
      options.originalInvoiceNumber ||
      (latestInvoice
        ? `${latestInvoice.invoiceId}-${latestInvoice.revision}`
        : null) ||
      (latestReceipt
        ? `${latestReceipt.receiptId}-${latestReceipt.revision}`
        : null) ||
      "-";

    const originalInvoiceDate =
      options.originalInvoiceDate ||
      latestInvoice?.timeCreated ||
      latestReceipt?.timeCreated ||
      reference.timeCreated;

    const pdf = groupBookingId
      ? await PdfService.generateAggregatedCancellationReceipt(
          tenantId,
          bookingIds,
          number,
          originalInvoiceNumber,
          { ...options, originalInvoiceDate, groupBookingId },
        )
      : await PdfService.generateSingleCancellationReceipt(
          tenantId,
          bookingIds[0],
          number,
          originalInvoiceNumber,
          { ...options, originalInvoiceDate },
        );

    const calculationOf = (bookingId) =>
      groupBookingId
        ? options.refundCalculations?.find(
            (calculation) => calculation.bookingId === bookingId,
          )
        : options.refundCalculation;

    return {
      name: pdf.name,
      buffer: pdf.buffer,
      attachmentFields: (bookingId) => {
        const calculation = calculationOf(bookingId);
        const audit = calculation ? { ...calculation } : {};
        delete audit.bookingId;
        return {
          ...(calculation?.cancelledAt !== undefined
            ? { timeCreated: calculation.cancelledAt }
            : {}),
          cancellation: {
            ...audit,
            originalDocumentRef: {
              number: originalInvoiceNumber,
              timeCreated: originalInvoiceDate,
            },
          },
        };
      },
    };
  }

  /**
   * The cancellation file, as a facade over the media library: cancellations
   * written since the media library exists are booking documents, older ones
   * still live in the legacy Nextcloud tree until the media import moves them.
   *
   * @param {string} tenantId - Tenant of the booking.
   * @param {string} cancellationName - File name stored on the attachment.
   * @param {string} [bookingId] - Booking the cancellation belongs to.
   * @returns {Promise<Buffer>} The cancellation bytes.
   */
  static async getCancellation(tenantId, cancellationName, bookingId) {
    try {
      return await readBookingDocument({
        tenantId,
        bookingId,
        fileName: cancellationName,
        type: BOOKING_DOCUMENT.CANCELLATION,
      });
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to get cancellation", {
          tenantId,
          cancellationName,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to retrieve cancellation: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }
}

module.exports = CancellationService;

function _findLatestAttachment(booking, type) {
  const attachments = booking.attachments?.filter((a) => a.type === type) || [];
  if (attachments.length === 0) return null;

  return attachments.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
}
