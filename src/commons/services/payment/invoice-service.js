const IdGenerator = require("../../utilities/id-generator");
const BookingManager = require("../../data-managers/booking-manager");
const { NextcloudManager } = require("../../data-managers/file-manager");
const PdfService = require("../../pdf-service/pdf-service");
const TenantManager = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invoice-service.js",
  level: process.env.LOG_LEVEL || "info",
});

class InvoiceService {
  static async createSingleInvoice(tenantId, bookingId) {
    try {
      const { invoiceNumber, invoiceId, revision } = await _createInvoiceNumber(
        tenantId,
        bookingId,
      );

      const pdfData = await PdfService.generateSingleInvoice(
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

      return {
        invoice: pdfData,
        name: pdfData.name,
        invoiceId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (error) {
      if (error.isNextcloudError) {
        logger.error("Failed to create invoice in Nextcloud", {
          tenantId,
          bookingId,
          error: error.message,
          statusCode: error.statusCode,
        });
        throw new Error(
          "Failed to save invoice: Nextcloud service is unavailable. Please try again later."
        );
      }
      throw error;
    }
  }

  static async createAggregatedInvoice(tenantId, bookingIds) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);

      if (!bookings || !tenant) {
        throw new Error("Booking or tenant not found.");
      }

      const allAttachments = bookings.flatMap(
        (b) => b.attachments?.filter((a) => a.type === "invoice") || [],
      );
      const existingIds = new Set(
        allAttachments.map((a) => a.invoiceId).filter(Boolean),
      );

      if (existingIds.size > 1) {
        throw new Error(
          "Cannot create aggregated invoice: bookings have different invoice IDs.",
        );
      }

      const { invoiceNumber, invoiceId, revision } = await _createInvoiceNumber(
        tenantId,
        bookings[0].id,
      );

      const pdfData = await PdfService.generateAggregatedInvoice(
        tenantId,
        bookings.map((b) => b.id),
        invoiceNumber,
      );

      await NextcloudManager.createFile(
        tenantId,
        pdfData.buffer,
        pdfData.name,
        "public",
        "invoices",
      );

      return {
        invoice: pdfData,
        name: pdfData.name,
        invoiceId,
        revision,
        timeCreated: Date.now(),
      };
    } catch (error) {
      if (error.isNextcloudError) {
        logger.error("Failed to create aggregated invoice in Nextcloud", {
          tenantId,
          bookingIds,
          error: error.message,
          statusCode: error.statusCode,
        });
        throw new Error(
          "Failed to save invoice: Nextcloud service is unavailable. Please try again later."
        );
      }
      throw error;
    }
  }

  static async getInvoice(tenantId, invoiceName) {
    try {
      return await NextcloudManager.getFile(
        tenantId,
        `invoices/${invoiceName}`,
      );
    } catch (err) {
      if (err.isNextcloudError) {
        logger.error("Failed to get invoice from Nextcloud", {
          tenantId,
          invoiceName,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to retrieve invoice: Nextcloud service is unavailable. Please try again later."
        );
      }
      throw err;
    }
  }
}

module.exports = InvoiceService;

async function _createInvoiceNumber(tenantId, bookingId) {
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
    const sorted = existingInvoices.sort((a, b) => b.revision - a.revision);
    const highestRevisionInvoice = sorted[0];

    invoiceId =
      highestRevisionInvoice.invoiceId ||
      (await IdGenerator.next(tenantId, 4, "invoice"));
    revision = highestRevisionInvoice.revision + 1;
  } else {
    invoiceId = await IdGenerator.next(tenantId, 4, "invoice");
  }

  const invoiceNumber = `${tenant.receiptNumberPrefix ? tenant.receiptNumberPrefix + '-' : ''}${invoiceId}-${revision}`;

  return {
    invoiceNumber,
    invoiceId,
    revision,
  };
}
