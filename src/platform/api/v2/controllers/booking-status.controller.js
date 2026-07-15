const bunyan = require("bunyan");
const BookingManager = require("../../../../commons/data-managers/booking-manager");
const {
  BOOKING_STATUS_REASONS,
  resolveBookingStatusKey,
} = require("../../../../commons/services/booking/booking-status-keys");
const { BookingStatusError } = require("../../../../errors/BookingStatusError");

const logger = bunyan.createLogger({
  name: "booking-status.controller.v2.js",
  level: process.env.LOG_LEVEL,
});

class BookingStatusControllerV2 {
  /**
   * Detailed booking status for one or more booking IDs (comma-separated).
   * Always HTTP 200; failures use success: false (see {@link BookingStatusError}).
   */
  static async getBookingStatus(req, res) {
    const fail = (bookingStatusError) =>
      res.status(200).json(bookingStatusError.toJSON());

    const tenantId = req.params.tenant;
    const idsParam = req.params.ids;

    if (!idsParam || String(idsParam).trim() === "") {
      return fail(
        new BookingStatusError({
          reason: BOOKING_STATUS_REASONS.MISSING_PARAMETERS,
          statusCode: 400,
          params: { missing: { ids: true } },
        }),
      );
    }

    const splitIds = [
      ...new Set(
        String(idsParam)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];

    if (splitIds.length === 0) {
      return fail(
        new BookingStatusError({
          reason: BOOKING_STATUS_REASONS.MISSING_PARAMETERS,
          statusCode: 400,
          params: { missing: { ids: true } },
        }),
      );
    }

    let bookings;
    try {
      bookings = await BookingManager.getBookings(tenantId, splitIds);
    } catch (err) {
      logger.error(
        { err, tenantId, splitIds },
        "getBookingStatus: load failed",
      );
      return fail(
        new BookingStatusError({
          reason: BOOKING_STATUS_REASONS.INTERNAL_ERROR,
          statusCode: 500,
          params: {},
        }),
      );
    }

    const byId = new Map(bookings.map((b) => [b.id, b]));

    const items = splitIds.map((bookingId) => {
      const booking = byId.get(bookingId);
      if (!booking) {
        return {
          bookingId,
          success: false,
          error: {
            reason: BOOKING_STATUS_REASONS.BOOKING_NOT_FOUND,
            params: { bookingId },
          },
        };
      }

      const priceEur = Number(booking.priceEur) || 0;

      return {
        bookingId,
        success: true,
        statusKey: resolveBookingStatusKey(booking),
        paymentProvider: booking.paymentProvider ?? null,
        isCommitted: Boolean(booking.isCommitted),
        isPayed: Boolean(booking.isPayed),
        isRejected: Boolean(booking.isRejected),
        priceEur,
      };
    });

    logger.info({ tenantId, count: items.length }, "getBookingStatus: ok");

    return res.status(200).json({
      success: true,
      data: { bookings: items },
    });
  }
}

module.exports = BookingStatusControllerV2;
