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

      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: {
          data: pdfData.buffer,
          name: pdfData.name,
        },
        subFolder: "invoices",
      });

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
          "Failed to save invoice: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw error;
    }
  }

  static async createAggregatedInvoice(
    tenantId,
    bookingIds,
    groupBookingId,
    bookings = null,
  ) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const resolvedBookings =
        bookings ?? (await BookingManager.getBookings(tenantId, bookingIds));

      if (!resolvedBookings || !tenant) {
        throw new Error("Booking or tenant not found.");
      }

      const allAttachments = resolvedBookings.flatMap(
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
        resolvedBookings[0].id,
      );

      const pdfData = await PdfService.generateAggregatedInvoice(
        tenantId,
        resolvedBookings.map((b) => b.id),
        invoiceNumber,
        { groupBookingId, bookings: resolvedBookings },
      );

      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: {
          data: pdfData.buffer,
          name: pdfData.name,
        },
        subFolder: "invoices",
      });

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
          "Failed to save invoice: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw error;
    }
  }

  /**
   * Creates an aggregated invoice and attaches it to all bookings in the group.
   * @param {string} tenantId
   * @param {string[]} bookingIds
   * @param {string|null} [groupBookingId]
   * @returns {Promise<{ invoice: object, name: string, invoiceId: string, revision: number, mail: string, bookingIds: string[] }>}
   */
  static async issueAggregatedInvoice(
    tenantId,
    bookingIds,
    groupBookingId,
    bookings = null,
  ) {
    const resolvedBookings =
      bookings ?? (await BookingManager.getBookings(tenantId, bookingIds));
    const invoiceData = await InvoiceService.createAggregatedInvoice(
      tenantId,
      bookingIds,
      groupBookingId,
      resolvedBookings,
    );

    await _attachAggregatedInvoiceToBookings(resolvedBookings, invoiceData);

    return {
      ...invoiceData,
      mail: resolvedBookings[0].mail,
      bookingIds: resolvedBookings.map((b) => b.id),
    };
  }

  static async getInvoice(tenantId, invoiceName) {
    try {
      return await NextcloudManager.getFile({
        tenant: tenantId,
        subFolder: "invoices",
        filename: invoiceName,
      });
    } catch (err) {
      if (err.isNextcloudError) {
        logger.error("Failed to get invoice from Nextcloud", {
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

async function _attachAggregatedInvoiceToBookings(
  bookings,
  { name, invoiceId, revision, timeCreated },
) {
  for (const booking of bookings) {
    booking.attachments.push({
      type: "invoice",
      name,
      invoiceId,
      revision,
      timeCreated,
      aggregated: true,
    });
    await BookingManager.storeBooking(booking);
  }
}

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

  const invoiceNumber = `${tenant.invoiceNumberPrefix ? tenant.invoiceNumberPrefix + "-" : ""}${invoiceId}-${revision}`;

  return {
    invoiceNumber,
    invoiceId,
    revision,
  };
}
