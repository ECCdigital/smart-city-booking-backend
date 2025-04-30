const PdfService = require("../../pdf-service/pdf-service");
const { NextcloudManager } = require("../../data-managers/file-manager");
const IdGenerator = require("../../utilities/id-generator");
const TenantManager = require("../../data-managers/tenant-manager");
const BookingManager = require("../../data-managers/booking-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "booking-controller.js",
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

      await NextcloudManager.createFile(
        tenantId,
        pdfData.buffer,
        pdfData.name,
        "public",
        "receipts",
      );

      return {
        receipt: pdfData,
        name: pdfData.name,
        receiptId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (err) {
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

      await NextcloudManager.createFile(
        tenantId,
        pdfData.buffer,
        pdfData.name,
        "public",
        "receipts",
      );

      return {
        receipt: pdfData,
        name: pdfData.name,
        receiptId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (err) {
      throw err;
    }
  }

  static async getReceipt(tenantId, receiptName) {
    try {
      return await NextcloudManager.getFile(
        tenantId,
        `receipts/${receiptName}`,
      );
    } catch (err) {
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
