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
  name: "cancellation-service.js",
  level: process.env.LOG_LEVEL,
});

class CancellationService {
  static async createSingleCancellation({ tenantId, bookingId, options = {} }) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);
      if (!booking) {
        throw new Error("Booking not found.");
      }

      const latestInvoice = _findLatestAttachment(booking, "invoice");
      const latestReceipt = _findLatestAttachment(booking, "receipt");

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
        booking.timeCreated;

      const { cancellationNumber, cancellationId, revision } =
        await _createCancellationNumber(tenantId, bookingId);

      const pdfData = await PdfService.generateSingleCancellationReceipt(
        tenantId,
        bookingId,
        cancellationNumber,
        originalInvoiceNumber,
        {
          ...options,
          originalInvoiceDate,
        },
      );

      await storeBookingDocument({
        tenantId,
        bookingIds: [bookingId],
        file: { data: pdfData.buffer, name: pdfData.name },
        type: BOOKING_DOCUMENT.CANCELLATION,
      });

      return {
        cancellation: pdfData,
        name: pdfData.name,
        cancellationId,
        cancellationNumber,
        originalInvoiceNumber,
        originalInvoiceDate,
        revision,
        timeCreated: options.refundCalculation?.cancelledAt ?? Date.now(),
      };
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to store cancellation", {
          tenantId,
          bookingId,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to save cancellation: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
  }

  static async createAggregatedCancellation({
    tenantId,
    bookingIds,
    groupBookingId,
    options = {},
  }) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);

      if (!bookings || bookings.length === 0 || !tenant) {
        throw new Error("Bookings or tenant not found.");
      }

      const allCancellationAttachments = bookings.flatMap(
        (b) => b.attachments?.filter((a) => a.type === "cancellation") || [],
      );

      const existingIds = new Set(
        allCancellationAttachments.map((a) => a.cancellationId).filter(Boolean),
      );

      if (existingIds.size > 1) {
        logger.error(
          { tenantId, bookingIds },
          "Cannot create aggregated cancellation: bookings have different cancellation IDs.",
        );
        throw new Error(
          "Cannot create aggregated cancellation: bookings have different cancellation IDs.",
        );
      }

      const latestInvoice = _findLatestAttachment(bookings[0], "invoice");
      const latestReceipt = _findLatestAttachment(bookings[0], "receipt");

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
        bookings[0].timeCreated;

      const { cancellationNumber, cancellationId, revision } =
        await _createCancellationNumber(tenantId, bookings[0].id);

      const pdfData = await PdfService.generateAggregatedCancellationReceipt(
        tenantId,
        bookings.map((b) => b.id),
        cancellationNumber,
        originalInvoiceNumber,
        {
          ...options,
          originalInvoiceDate,
          groupBookingId,
        },
      );

      await storeBookingDocument({
        tenantId,
        bookingIds: bookings.map((booking) => booking.id),
        file: { data: pdfData.buffer, name: pdfData.name },
        type: BOOKING_DOCUMENT.CANCELLATION,
      });

      return {
        cancellation: pdfData,
        name: pdfData.name,
        cancellationId,
        cancellationNumber,
        originalInvoiceNumber,
        originalInvoiceDate,
        revision,
        timeCreated: options.refundCalculations?.[0]?.cancelledAt ?? Date.now(),
      };
    } catch (err) {
      if (isStorageFailure(err)) {
        logger.error("Failed to store aggregated cancellation", {
          tenantId,
          bookingIds,
          error: err.message,
          statusCode: err.statusCode,
        });
        throw new Error(
          "Failed to save cancellation: Nextcloud service is unavailable. Please try again later.",
        );
      }
      throw err;
    }
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

async function _createCancellationNumber(tenantId, bookingId) {
  const tenant = await TenantManager.getTenant(tenantId);
  const booking = await BookingManager.getBooking(bookingId, tenantId);
  if (!booking || !tenant) {
    throw new Error("Booking or tenant not found.");
  }

  const existingCancellations =
    booking.attachments?.filter(
      (attachment) => attachment.type === "cancellation",
    ) || [];

  let revision = 1;
  let cancellationId;

  if (existingCancellations.length > 0) {
    const sorted = existingCancellations.sort(
      (a, b) => b.revision - a.revision,
    );
    const highestRevision = sorted[0];

    cancellationId =
      highestRevision.cancellationId ||
      (await IdGenerator.next(tenantId, 4, "cancellation"));
    revision = highestRevision.revision + 1;
  } else {
    cancellationId = await IdGenerator.next(tenantId, 4, "cancellation");
  }

  const prefix = (tenant.cancellationNumberPrefix || "").trim();
  const cancellationNumber = `${prefix ? `${prefix}-` : ""}${cancellationId}-${revision}`;

  return { cancellationNumber, cancellationId, revision };
}

function _findLatestAttachment(booking, type) {
  const attachments = booking.attachments?.filter((a) => a.type === type) || [];
  if (attachments.length === 0) return null;

  return attachments.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
}
