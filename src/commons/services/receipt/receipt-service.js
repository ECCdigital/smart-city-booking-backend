const PdfService = require("../../pdf-service/pdf-service");
const { NextcloudManager } = require("../../data-managers/file-manager");
const IdGenerator = require("../../utilities/id-generator");
const TenantManager = require("../../data-managers/tenant-manager");
const BookingManager = require("../../data-managers/booking-manager");

class ReceiptService {
  static async createReceipt(tenantId, bookingId) {
    try {
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
      let receiptId = null;

      if (existingReceipts.length > 0) {
        revision =
          Math.max(...existingReceipts.map((receipt) => receipt.revision)) + 1;
        receiptId =
          existingReceipts[0].receiptId ||
          (await IdGenerator.next(tenantId, 4));
      } else {
        receiptId = await IdGenerator.next(tenantId, 4);
      }

      const receiptNumber = `${tenant.receiptNumberPrefix}-${receiptId}-${revision}`;

      const pdfData = await PdfService.generateReceipt(
        bookingId,
        tenantId,
        receiptNumber,
      );

      await NextcloudManager.createFile(
        tenantId,
        pdfData.buffer,
        pdfData.name,
        "public",
        "receipts",
      );

      booking.attachments.push({
        type: "receipt",
        name: pdfData.name,
        receiptId: receiptId,
        revision: revision,
        timeCreated: Date.now(),
      });

      await BookingManager.storeBooking(booking);

      return pdfData;
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
