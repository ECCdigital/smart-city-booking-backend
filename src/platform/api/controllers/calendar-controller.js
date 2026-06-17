const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const CalendarService = require("../../../commons/services/calendar-service");
const CalendarServiceV2 = require("../../../commons/services/calendar-service-v2");
const { NotFoundError } = require("../../../errors/BaseError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "calendar-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * CalendarController class.
 *
 * This class is responsible for handling requests related to occupancies in the calendar.
 */
class CalendarController {
  static async getOccupancies(request, response) {
    const tenant = request.params.tenant;
    const bookableIds = request.query.ids;
    let occupancies = [];

    let bookables = await BookableManager.getBookables(tenant);

    if (bookableIds && bookableIds.length > 0) {
      bookables = bookables.filter((bookable) =>
        bookableIds.includes(bookable.id),
      );
    }

    for (const bookable of bookables) {
      const relatedBookables = await BookableManager.getRelatedBookables(
        bookable.id,
        tenant,
      );

      const relatedIds = relatedBookables.map((rb) => rb.id);
      relatedIds.push(bookable.id);

      const bookings = await BookingManager.getRelatedBookingsBatch(
        tenant,
        relatedIds,
      );

      const bookingMap = new Map();
      for (const booking of bookings) {
        bookingMap.set(booking.id, booking);
      }
      const uniqueBookings = [...bookingMap.values()];

      occupancies.push(
        ...uniqueBookings
          .filter(
            (booking) =>
              !!booking.timeBegin && !!booking.timeEnd && !booking.isRejected,
          )
          .map((booking) => ({
            bookableId: bookable.id,
            title: bookable.title,
            timeBegin: booking.timeBegin,
            timeEnd: booking.timeEnd,
          })),
      );
    }

    response.status(200).send(occupancies);
  }

  /**
   * Primary availability endpoint (V2 engine, shared availability-rules).
   *
   * @example
   * // GET /api/<tenant>/bookables/<bookableId>/availability?amount=1&startDate=2022-01-01&endDate=2022-01-07
   */
  static async getBookableAvailability(request, response) {
    return CalendarController.#respondWithAvailabilityV2(request, response);
  }

  /**
   * Alias for {@link getBookableAvailability} during client migration.
   */
  static async getBookableAvailabilityV2(request, response) {
    return CalendarController.#respondWithAvailabilityV2(request, response);
  }

  /**
   * @deprecated Use GET /availability (V2). Removed in a future release.
   * @example
   * // GET /api/<tenant>/bookables/<bookableId>/availability/v1?amount=1&startDate=2022-01-01&endDate=2022-01-07
   */
  static async getBookableAvailabilityV1(request, response) {
    const {
      params: { tenant, id: bookableId },
      user,
      query: { amount = 1, startDate: startDateQuery, endDate: endDateQuery },
    } = request;

    if (!tenant || !bookableId) {
      return response
        .status(400)
        .send({ error: "Tenant ID and bookable ID are required." });
    }

    CalendarController.#setV1DeprecationHeaders(response, tenant, bookableId);
    logger.warn(
      {
        tenantId: tenant,
        bookableId,
        path: request.originalUrl,
      },
      "deprecated availability v1 endpoint called",
    );

    try {
      const availability = await CalendarService.checkAvailability(
        String(tenant),
        String(bookableId).trim(),
        startDateQuery,
        endDateQuery,
        Number(amount),
        user,
      );

      response.status(200).send(availability);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return response.status(404).send({
          error: `Bookable with id ${bookableId} not found`,
          code: error.code,
        });
      }
      console.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
  }

  static #setV1DeprecationHeaders(response, tenant, bookableId) {
    response.set("Deprecation", "true");
    response.set("Sunset", "Thu, 01 Jan 2027 00:00:00 GMT");
    response.set(
      "Link",
      `</api/${encodeURIComponent(tenant)}/bookables/${encodeURIComponent(bookableId)}/availability>; rel="successor-version"`,
    );
    response.set(
      "Warning",
      '299 - "GET /availability/v1 is deprecated; use GET /availability instead."',
    );
    response.set("X-Availability-Engine", "v1-legacy");
  }

  static #setV2ResponseHeaders(response) {
    response.set("X-Availability-Engine", "v2");
  }

  static async #respondWithAvailabilityV2(request, response) {
    const {
      params: { tenant, id: bookableId },
      user,
      query: { amount = 1, startDate: startDateQuery, endDate: endDateQuery },
    } = request;

    if (!tenant || !bookableId) {
      return response
        .status(400)
        .send({ error: "Tenant ID and bookable ID are required." });
    }

    try {
      const availability = await CalendarServiceV2.checkAvailability(
        String(tenant),
        String(bookableId).trim(),
        startDateQuery,
        endDateQuery,
        Number(amount),
        user,
      );

      CalendarController.#setV2ResponseHeaders(response);
      response.status(200).send(availability);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return response.status(404).send({
          error: `Bookable with id ${bookableId} not found`,
          code: error.code,
        });
      }
      console.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
  }
}

module.exports = CalendarController;
