const {
  periodHelpers: {
    generateTimePeriodsFromMaxBookingAdvance,
    generateTimePeriodsFromOpeningHours,
    generateTimePeriodsFromTimePeriods,
    generateTimePeriodsFromSpecialOpeningHours,
    getUnavailablePeriods,
    mergePeriods,
  },
} = require("./calendar-service");
const {
  AvailabilityContext,
} = require("./availability/availability-context");
const {
  computeWindowAvailability,
} = require("./availability/capacity-interval-calculator");
const {
  mergeAvailabilitySegments,
} = require("./availability/availability-interval-merger");
const {
  hasBookingPermission,
  hasEventSeatsAvailable,
  isEventDateBookable,
} = require("../availability/calendar-v2-context-checks");
const {
  applyBookingDurationRules,
} = require("./availability/availability-duration-filter");
const { NotFoundError } = require("../../errors/BaseError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "calendar-service-v2.js",
  level: process.env.LOG_LEVEL,
});

class CalendarServiceV2 {
  /**
   * Optimized availability check with request-scoped caching, sweep-line
   * capacity calculation, and checkout-aligned accuracy rules (Phase 0–3).
   */
  static async checkAvailability(
    tenantId,
    bookableId,
    start,
    end,
    amount,
    user,
  ) {
    const startedAt = Date.now();
    const startDate = start ? new Date(start) : new Date();
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(24, 0, 0, 0);

    const timeBegin = startDate.getTime();
    const timeEnd = endDate.getTime();

    const context = await AvailabilityContext.create(
      tenantId,
      bookableId,
      timeBegin,
      timeEnd,
    );

    const bookable = context.bookable;

    if (!bookable) {
      throw new NotFoundError("bookable_not_found", { bookableId, tenantId });
    }

    if (bookable.isBookable === false) {
      return CalendarServiceV2.#buildResponse(
        bookable.title,
        [{ timeBegin, timeEnd, available: false }],
        context,
        startedAt,
      );
    }

    if (bookable.amount && Number(bookable.amount) < Number(amount)) {
      return CalendarServiceV2.#buildResponse(
        bookable.title,
        [{ timeBegin, timeEnd, available: false }],
        context,
        startedAt,
      );
    }

    const userId = user?.id ?? user;
    const permissionGranted = await hasBookingPermission(context, userId);
    if (!permissionGranted) {
      return CalendarServiceV2.#buildResponse(
        bookable.title,
        [{ timeBegin, timeEnd, available: false }],
        context,
        startedAt,
      );
    }

    if (!hasEventSeatsAvailable(context, Number(amount))) {
      return CalendarServiceV2.#buildResponse(
        bookable.title,
        [{ timeBegin, timeEnd, available: false }],
        context,
        startedAt,
      );
    }

    if (!isEventDateBookable(context)) {
      return CalendarServiceV2.#buildResponse(
        bookable.title,
        [{ timeBegin, timeEnd, available: false }],
        context,
        startedAt,
      );
    }

    const maxBookingAdvanceInMonths = context.tenant?.maxBookingAdvanceInMonths;

    const availableOpeningHoursPeriods = generateTimePeriodsFromOpeningHours(
      startDate,
      endDate,
      [bookable, ...context.parentBookables],
    );

    const availableTimePeriods = generateTimePeriodsFromTimePeriods(
      startDate,
      endDate,
      bookable,
    );

    const availableSpecialOpeningHoursPeriods =
      generateTimePeriodsFromSpecialOpeningHours(startDate, endDate, [
        bookable,
        ...context.parentBookables,
      ]);

    const maxBookingAdvancePeriods = generateTimePeriodsFromMaxBookingAdvance(
      startDate,
      endDate,
      maxBookingAdvanceInMonths,
    );

    const availablePeriods = mergePeriods(
      availableOpeningHoursPeriods,
      availableSpecialOpeningHoursPeriods,
      availableTimePeriods,
      maxBookingAdvancePeriods,
    );

    const items = [];
    for (const period of availablePeriods) {
      if (!period.available) {
        items.push({
          timeBegin: period.start,
          timeEnd: period.end,
          available: false,
        });
        continue;
      }

      context.recordSegmentCheck();
      const capacitySegments = computeWindowAvailability(
        context,
        bookable,
        period.start,
        period.end,
        Number(amount),
      );

      items.push(...capacitySegments);
    }

    const closedPeriods = getUnavailablePeriods(
      availableOpeningHoursPeriods,
      availableSpecialOpeningHoursPeriods,
    );
    items.push(
      ...closedPeriods.map((period) => ({
        timeBegin: period.start,
        timeEnd: period.end,
        available: false,
      })),
    );

    const segments = mergeAvailabilitySegments(
      applyBookingDurationRules(items, bookable),
    );
    const response = CalendarServiceV2.#buildResponse(
      bookable.title,
      segments,
      context,
      startedAt,
    );

    logger.info(
      {
        tenantId,
        bookableId,
        durationMs: response._metrics.durationMs,
        dbQueryCount: response._metrics.dbQueryCount,
        segmentChecks: response._metrics.segmentChecks,
        segmentCount: segments.length,
      },
      "availability v2 check completed",
    );

    return response;
  }

  static #buildResponse(title, availability, context, startedAt) {
    return {
      title,
      availability,
      _metrics: {
        version: "v2-r5",
        durationMs: Date.now() - startedAt,
        dbQueryCount: context.metrics.dbQueryCount,
        segmentChecks: context.metrics.segmentChecks,
      },
    };
  }
}

module.exports = CalendarServiceV2;
