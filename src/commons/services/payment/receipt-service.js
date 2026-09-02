const PdfService = require("../../pdf-service/pdf-service");
const IdGenerator = require("../../utilities/id-generator");
const TenantManager = require("../../data-managers/tenant-manager");
const BookingManager = require("../../data-managers/booking-manager");
const {
  BOOKING_DOCUMENT,
  isStorageFailure,
  readBookingDocument,
  storeBookingDocument,
} = require("../media/booking-documents");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "receipt-service.js",
  level: process.env.LOG_LEVEL,
});

class ReceiptService {
  static async createSingleReceipt(tenantId, bookingId) {
    try {
      const { receiptNumber, receiptId, revision } = await _createReceiptNumber(
        tenantId,
        bookingId,
      );

      const pdfData = await PdfService.generateSingleReceipt(
        tenantId,
        bookingId,
        receiptNumber,
      );

      await storeBookingDocument({
        tenantId,
        bookingIds: [bookingId],
        file: { data: pdfData.buffer, name: pdfData.name },
        type: BOOKING_DOCUMENT.RECEIPT,
      });

      return {
        receipt: pdfData,
        name: pdfData.name,
        receiptId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to store receipt", {
          tenantId,
          bookingId,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to save receipt: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }

  static async createAggregatedReceipt(tenantId, bookingIds) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);

      if (!bookings || !tenant) {
        throw new Error("Booking or tenant not found.");
      }

      const allAttachments = bookings.flatMap(
        (b) => b.attachments?.filter((a) => a.type === "receipt") || [],
      );

      const existingIds = new Set(
        allAttachments.map((a) => a.receiptId).filter(Boolean),
      );

      if (existingIds.size > 1) {
        logger.error(
          { tenantId: tenantId, bookingIds: bookingIds },
          "Cannot create aggregated receipt: bookings have different receipt IDs.",
        );
        throw new Error(
          "Cannot create aggregated receipt: bookings have different receipt IDs.",
        );
      }

      const { receiptNumber, receiptId, revision } = await _createReceiptNumber(
        tenantId,
        bookings[0].id,
      );

      const pdfData = await PdfService.generateAggregatedReceipt(
        tenantId,
        bookings.map((b) => b.id),
        receiptNumber,
      );

      await storeBookingDocument({
        tenantId,
        bookingIds: bookings.map((booking) => booking.id),
        file: { data: pdfData.buffer, name: pdfData.name },
        type: BOOKING_DOCUMENT.RECEIPT,
      });

      return {
        receipt: pdfData,
        name: pdfData.name,
        receiptId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to store aggregated receipt", {
          tenantId,
          bookingIds,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to save receipt: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
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

async function _createReceiptNumber(tenantId, bookingId) {
  const tenant = await TenantManager.getTenant(tenantId);
  const booking = await BookingManager.getBooking(bookingId, tenantId);
  if (!booking || !tenant) {
    throw new Error("Booking or tenant not found.");
  }

  const existingReceipts =
    booking.attachments?.filter(
      (attachment) => attachment.type === "receipt",
    ) || [];

  let revision = 1;
  let receiptId;

  if (existingReceipts.length > 0) {
    const sorted = existingReceipts.sort((a, b) => b.revision - a.revision);
    const highestRevisionReceipt = sorted[0];

    receiptId =
      highestRevisionReceipt.receiptId ||
      (await IdGenerator.next(tenantId, 4, "receipt"));
    revision = highestRevisionReceipt.revision + 1;
  } else {
    receiptId = await IdGenerator.next(tenantId, 4, "receipt");
  }

  const receiptNumber = `${tenant.receiptNumberPrefix}-${receiptId}-${revision}`;

  return { receiptNumber, receiptId, revision };
}
