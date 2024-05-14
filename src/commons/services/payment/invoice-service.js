const IdGenerator = require("../../utilities/id-generator");
const BookingManager = require("../../data-managers/booking-manager");
const { NextcloudManager } = require("../../data-managers/file-manager");
const PdfService = require("../../pdf-service/pdf-service");
const TenantManager = require("../../data-managers/tenant-manager");

class InvoiceService {
  static async createInvoice(tenantId, bookingId) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const booking = await BookingManager.getBooking(bookingId, tenantId);

      if (!booking || !tenant) {
        throw new Error("Booking or tenant not found.");
      }

      const existingInvoices =
        booking.attachments?.filter(
          (attachment) => attachment.type === "invoice",
        ) || [];

      let revision = 1;
      let invoiceId;

      if (existingInvoices.length > 0) {
        revision =
          Math.max(...existingInvoices.map((invoice) => invoice.revision)) + 1;
        invoiceId =
          existingInvoices[0].invoiceId ||
          await IdGenerator.next(tenantId, 4, "invoice");
      } else {
        invoiceId = await IdGenerator.next(tenantId, 4, "invoice");
      }

      const invoiceNumber = `${tenant.invoiceNumberPrefix}-${invoiceId}-${revision}`;

      const pdfData = await PdfService.generateInvoice(
        tenantId,
        bookingId,
        invoiceNumber,
      );

      await NextcloudManager.createFile(
        tenantId,
        pdfData.buffer,
        pdfData.name,
        "public",
        "invoices",
      );

      booking.attachments.push({
        type: "invoice",
        name: pdfData.name,
        invoiceId: invoiceId,
        revision: revision,
        timeCreated: Date.now(),
      });
      await BookingManager.storeBooking(booking);

      return pdfData;
    } catch (error) {
      throw new Error(error);
    }
  }

  static async getInvoice(tenantId, invoiceName) {
    try {
      return await NextcloudManager.getFile(
        tenantId,
        `invoices/${invoiceName}`,
      );
    } catch (err) {
      throw err;
    }
  }
}

module.exports = InvoiceService;
