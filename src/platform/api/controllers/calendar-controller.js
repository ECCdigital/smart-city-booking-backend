const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const { scopeOf } = require("../../../commons/services/authorization");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const CalendarService = require("../../../commons/services/calendar-service");
const CalendarServiceV2 = require("../../../commons/services/calendar-service-v2");
const BlockPeriodService = require("../../../commons/services/block-period-service");
const {
  BaseError,
  NotFoundError,
  BadRequestError,
} = require("../../../errors/BaseError");
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
  /**
   * `GET /calendar/occupancy`: the occupancies of the bookables within the
   * reach of the request (`calendar.all`: the public's, or the tenant's
   * whole for the staff). The aggregate over the tenant is a list, the
   * bookables the caller names by id are direct links - the manager
   * projects either under `public` (ADR 0003), and a tenant without a
   * public projection is the public's 404.
   */
  static async getOccupancies(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const bookableIds = request.query.ids;
      const occupancies = [];

      const bookables =
        bookableIds && bookableIds.length > 0
          ? await BookableManager.getBookablesByIds(
              tenant,
              [].concat(bookableIds),
              scopeOf(request),
            )
          : await BookableManager.getBookables(tenant, scopeOf(request));

      for (const bookable of bookables) {
        const relatedBookables = await BookableManager.getRelatedBookables(
          bookable.id,
          tenant,
          scopeOf(request),
        );

        const relatedIds = relatedBookables.map((rb) => rb.id);
        relatedIds.push(bookable.id);

        const bookings = await BookingManager.getRelatedBookingsBatch(
          tenant,
          relatedIds,
          scopeOf(request),
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
    } catch (err) {
      if (err instanceof BaseError) {
        return next(err);
      }
      logger.error(err);
      response.status(500).send("Could not get occupancies");
    }
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
   * Lists available block-period instances for a block-period bookable.
   *
   * @example
   * // GET /api/<tenant>/bookables/<bookableId>/block-periods?amount=1&startDate=2026-01-01&endDate=2026-01-31
   */
  static async getBookableBlockPeriods(request, response) {
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
      await CalendarController.#assertWithinReach(request, tenant, bookableId);
      const result = await BlockPeriodService.getAvailableBlockPeriods(
        String(tenant),
        String(bookableId).trim(),
        startDateQuery,
        endDateQuery,
        Number(amount),
        user,
      );

      response.status(200).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return response.status(404).send({
          error: `Bookable with id ${bookableId} not found`,
          code: error.code,
        });
      }

      if (error instanceof BadRequestError) {
        const messages = {
          not_block_period_bookable:
            "Bookable is not configured for block-period bookings",
          invalid_date_range: "Invalid date range provided",
          date_range_too_large: "Date range exceeds maximum limit",
        };

        return response.status(400).send({
          error: messages[error.code] || "Bad request",
          code: error.code,
        });
      }

      console.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
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
      await CalendarController.#assertWithinReach(request, tenant, bookableId);
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

  /**
   * The bookable of the route within the reach of the request (ADR 0002):
   * what the public reaches by a direct link (ADR 0003), or the 404 that
   * names no reason (spec §5.2). The availability itself the domain
   * computes over the bookable and its dependents.
   *
   * @throws {NotFoundError} `bookable_not_found`, or the projection's
   *   `tenant_not_found`
   */
  static async #assertWithinReach(request, tenant, bookableId) {
    const bookable = await BookableManager.getBookable(
      String(bookableId).trim(),
      String(tenant),
      scopeOf(request),
    );
    if (!bookable) {
      throw new NotFoundError("bookable_not_found", {
        bookableId,
        tenantId: tenant,
      });
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
      await CalendarController.#assertWithinReach(request, tenant, bookableId);
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
