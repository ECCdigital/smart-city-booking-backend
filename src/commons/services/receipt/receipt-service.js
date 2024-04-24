const PdfService = require("../../pdf-service/pdf-service");
const FileManager = require("../../data-managers/file-manager");
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


      const existingReceipts = booking.attachments?.filter(
        (attachment) => attachment.type === "receipt",
      ) || [];
      
      let revision = 1;
      let receiptId = null;

      if(existingReceipts.length > 0) {
        revision = Math.max(...existingReceipts.map(receipt => receipt.revision)) + 1;
        receiptId = existingReceipts[0].receiptId;
      } else {
        receiptId = await IdGenerator.next(tenantId, 4);
      }

      const receiptNumber =`${tenant.receiptNumberPrefix}-${receiptId}-${revision}`;

      const pdfData = await PdfService.generateReceipt(
        bookingId,
        tenantId,
        receiptNumber,
      );

      await FileManager.createFile(
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
        revision: version,
      });

      await BookingManager.storeBooking(booking);

      return pdfData;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = ReceiptService;
