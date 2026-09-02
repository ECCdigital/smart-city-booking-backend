const bunyan = require("bunyan");
const { BOOKABLE_TYPES } = require("../entities/bookable/bookable");
const { CHECK_TYPES } = require("./checkout-check-types");
const { CHECKOUT_REASONS } = require("../services/checkout/checkout-reasons");
const { getBookingsForCapacityCheck } = require("./check-window-availability");
const {
  isTimeRelatedBookable,
  sumBookedAmount,
  evaluateOriginCapacity,
  evaluateParentCapacity,
  evaluateChildCapacity,
  isEventBookable,
  hasEventSeats,
  getBookingDurationHours,
  hasBookingPermission,
  isWithinMaxBookingAdvance,
  isWithinMinBookingLeadTime,
  CAPACITY_MODES,
  isBlockPeriodBookingValid,
  isTimePeriodBookingValid,
} = require("./availability-rules");

const logger = bunyan.createLogger({
  name: "checkout-availability-checks.js",
  level: process.env.LOG_LEVEL,
});

/**
 * @template T
 * @param {T|Promise<T>} value
 * @returns {Promise<T>}
 */
async function resolve(value) {
  return await value;
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} bookings
 * @returns {Array<{ id: string, timeBegin: number, timeEnd: number }>}
 */
function summarizeBookings(bookings) {
  return bookings.map((booking) => ({
    id: booking.id,
    timeBegin: booking.timeBegin,
    timeEnd: booking.timeEnd,
  }));
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} originBookable
 * @param {number|null|undefined} timeBegin
 * @param {number|null|undefined} timeEnd
 */
function assertTimeRangeForOrigin(originBookable, timeBegin, timeEnd) {
  if (isTimeRelatedBookable(originBookable) && (!timeBegin || !timeEnd)) {
    logger.warn(
      `Bookable with ID ${originBookable.id} is time related but no time is given.`,
    );
    throw {
      checkType: CHECK_TYPES.TIME_RELATION,
      available: false,
      message: `Das Objekt ${originBookable.title} ist zeitbezogen, aber es wurde kein Zeitraum angegeben.`,
    };
  }
}

/**
 * @param {string|string[]|null|undefined} excludeBookingIds
 * @returns {Set<string>}
 */
function toExcludeBookingIdSet(excludeBookingIds) {
  if (!excludeBookingIds) {
    return new Set();
  }
  const ids = Array.isArray(excludeBookingIds)
    ? excludeBookingIds
    : [excludeBookingIds];
  return new Set(ids.filter(Boolean).map(String));
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} bookings
 * @param {string|string[]|null|undefined} excludeBookingIds
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function filterExcludedBookings(bookings, excludeBookingIds) {
  const excludeSet = toExcludeBookingIdSet(excludeBookingIds);
  if (excludeSet.size === 0) {
    return bookings;
  }
  return bookings.filter((booking) => !excludeSet.has(String(booking.id)));
}

/**
 * @param {import("./providers/availability-data-provider").AvailabilityDataProvider} provider
 * @param {import("../../entities/bookable/bookable").Bookable} originBookable
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @param {string|string[]|null|undefined} [excludeBookingIds]
 * @returns {Promise<{ amountBooked: number, bookings: import("../../entities/booking/booking").Booking[] }>}
 */
async function getBookedAmountForBookableWindow(
  provider,
  originBookable,
  bookable,
  timeBegin,
  timeEnd,
  excludeBookingIds,
) {
  assertTimeRangeForOrigin(originBookable, timeBegin, timeEnd);

  const rawBookings = await getBookingsForCapacityCheck(
    provider,
    bookable,
    timeBegin,
    timeEnd,
    { useTimeOverlap: isTimeRelatedBookable(originBookable) },
  );
  const bookings = filterExcludedBookings(rawBookings, excludeBookingIds);

  return {
    amountBooked: sumBookedAmount(bookings, bookable.id),
    bookings,
  };
}

/**
 * @param {Object} params
 * @param {import("./providers/availability-data-provider").AvailabilityDataProvider} params.provider
 * @param {import("../../entities/bookable/bookable").Bookable} params.originBookable
 * @param {string|undefined|null} params.userId
 * @returns {Promise<Object>}
 */
async function runPermissionCheck({ provider, originBookable, userId }) {
  const tenantId = await resolve(provider.getTenantId());

  if (!(await hasBookingPermission(originBookable, userId, tenantId))) {
    if (originBookable?.isBookable !== true) {
      throw {
        checkType: CHECK_TYPES.PERMISSION,
        reason: CHECKOUT_REASONS.BOOKABLE_NOT_BOOKABLE,
        available: false,
        message: `Das Objekt ${originBookable.title}, mit der ID ${originBookable.id} ist nicht buchbar.`,
      };
    }

    throw {
      checkType: CHECK_TYPES.PERMISSION,
      available: false,
      message: `Sie haben keine Berechtigung, das Objekt ${originBookable.title} zu buchen.`,
    };
  }

  return { checkType: CHECK_TYPES.PERMISSION, available: true };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runAvailabilityCheck({
  provider,
  originBookable,
  amount,
  timeBegin,
  timeEnd,
  excludeBookingIds,
}) {
  const { amountBooked, bookings } = await getBookedAmountForBookableWindow(
    provider,
    originBookable,
    originBookable,
    timeBegin,
    timeEnd,
    excludeBookingIds,
  );

  const capacityResult = evaluateOriginCapacity({
    bookings,
    bookableId: originBookable.id,
    capacity: originBookable.amount,
    amount: Number(amount),
    mode: CAPACITY_MODES.ADDITIVE,
  });

  if (!capacityResult.available) {
    throw {
      checkType: CHECK_TYPES.AVAILABILITY,
      available: false,
      message: `Das Objekt ${originBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
      totalCapacity: originBookable.amount,
      booked: amountBooked,
      remaining:
        originBookable.amount > 0 ? originBookable.amount - amountBooked : null,
      concurrentBookings: summarizeBookings(bookings),
    };
  }

  return {
    checkType: CHECK_TYPES.AVAILABILITY,
    available: true,
    totalCapacity: originBookable.amount,
    booked: amountBooked,
    remaining:
      originBookable.amount > 0 ? originBookable.amount - amountBooked : null,
  };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runParentAvailabilityCheck({
  provider,
  originBookable,
  amount,
  timeBegin,
  timeEnd,
  excludeBookingIds,
}) {
  const parentBookables = await resolve(provider.getParentBookables());
  const parentAmount = [];

  for (const parentBookable of parentBookables) {
    const { amountBooked: parentAmountBooked, bookings } =
      await getBookedAmountForBookableWindow(
        provider,
        originBookable,
        parentBookable,
        timeBegin,
        timeEnd,
        excludeBookingIds,
      );

    const isTicketChild = originBookable.type === "ticket";
    let childTicketAmountBooked = 0;

    if (isTicketChild) {
      const childBookables = await resolve(
        provider.getRelatedBookablesFor(parentBookable.id),
      );

      for (const childBookable of childBookables) {
        const { amountBooked } = await getBookedAmountForBookableWindow(
          provider,
          originBookable,
          childBookable,
          timeBegin,
          timeEnd,
          excludeBookingIds,
        );
        childTicketAmountBooked += amountBooked;
      }
    }

    const isAvailable = evaluateParentCapacity({
      parentAmountBooked,
      childTicketAmountBooked,
      capacity: parentBookable.amount,
      requestedAmount: Number(amount),
      isTicketChild,
    });

    parentAmount.push({
      bookableId: parentBookable.id,
      title: parentBookable.title,
      totalCapacity: parentBookable.amount,
      booked: parentAmountBooked,
      remaining: parentBookable.amount - parentAmountBooked,
      isAvailable,
    });

    if (!isAvailable) {
      throw {
        checkType: CHECK_TYPES.PARENT_AVAILABILITY,
        available: false,
        message: `Übergeordnetes Objekt ${parentBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
        parentAvailability: parentAmount,
        concurrentBookings: summarizeBookings(bookings),
      };
    }
  }

  return {
    checkType: CHECK_TYPES.PARENT_AVAILABILITY,
    available: true,
    parentAvailabilities: parentAmount,
  };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runChildBookingsCheck({
  provider,
  originBookable,
  amount,
  timeBegin,
  timeEnd,
  excludeBookingIds,
}) {
  const relatedBookables = await resolve(provider.getRelatedBookables());
  const childAmount = [];

  for (const childBookable of relatedBookables) {
    if (childBookable.id === originBookable.id) {
      continue;
    }

    const { amountBooked, bookings } = await getBookedAmountForBookableWindow(
      provider,
      originBookable,
      childBookable,
      timeBegin,
      timeEnd,
      excludeBookingIds,
    );

    const isAvailable = evaluateChildCapacity({
      childAmountBooked: amountBooked,
      capacity: childBookable.amount,
      requestedAmount: Number(amount),
    });

    childAmount.push({
      bookableId: childBookable.id,
      title: childBookable.title,
      totalCapacity: childBookable.amount,
      booked: amountBooked,
      remaining: childBookable.amount - amountBooked,
    });

    if (!isAvailable) {
      throw {
        checkType: CHECK_TYPES.CHILD_BOOKINGS,
        available: false,
        message: `Abhängiges Objekt ${childBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
        totalCapacity: childBookable.amount,
        booked: amountBooked,
        remaining: childBookable.amount - amountBooked,
        concurrentBookings: summarizeBookings(bookings),
      };
    }
  }

  return {
    checkType: CHECK_TYPES.CHILD_BOOKINGS,
    available: true,
    childAvailabilities: childAmount,
  };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runEventSeatsCheck({ provider, originBookable, amount }) {
  if (
    originBookable.type !== BOOKABLE_TYPES.TICKET ||
    !originBookable.eventId
  ) {
    return {
      checkType: CHECK_TYPES.EVENT_SEATS,
      available: true,
    };
  }

  const tenantId = await resolve(provider.getTenantId());
  const event = await resolve(provider.getEvent());
  const eventBookings = await resolve(provider.getEventBookings());
  const seats = hasEventSeats(
    eventBookings,
    originBookable.eventId,
    tenantId,
    Number(amount),
    event?.attendees?.maxAttendees,
  );

  if (!seats.available) {
    throw {
      checkType: CHECK_TYPES.EVENT_SEATS,
      available: false,
      message: `Die Veranstaltung ${event.information.name} hat nicht ausreichend freie Plätze.`,
      totalCapacity: event.attendees.maxAttendees,
      booked: seats.amountBooked,
      remaining: seats.remaining,
    };
  }

  return {
    checkType: CHECK_TYPES.EVENT_SEATS,
    available: true,
    totalCapacity: event?.attendees?.maxAttendees,
    booked: seats.amountBooked,
    remaining: seats.remaining,
  };
}

/**
 * @param {Object} params
 * @returns {Object}
 */
function runBookingDurationCheck({ originBookable, timeBegin, timeEnd }) {
  if (!originBookable.isScheduleRelated) {
    return { checkType: CHECK_TYPES.BOOKING_DURATION, available: true };
  }

  const hours = getBookingDurationHours(timeBegin, timeEnd);

  if (
    originBookable.minBookingDuration &&
    hours < Number(originBookable.minBookingDuration)
  ) {
    throw {
      checkType: CHECK_TYPES.BOOKING_DURATION,
      reason: CHECKOUT_REASONS.DURATION_TOO_SHORT,
      available: false,
      message: `Die Buchungsdauer für das Objekt ${originBookable.title} muss mindestens ${originBookable.minBookingDuration} Stunden betragen.`,
    };
  }

  if (
    originBookable.maxBookingDuration &&
    hours > Number(originBookable.maxBookingDuration)
  ) {
    throw {
      checkType: CHECK_TYPES.BOOKING_DURATION,
      reason: CHECKOUT_REASONS.DURATION_TOO_LONG,
      available: false,
      message: `Die Buchungsdauer für das Objekt ${originBookable.title} darf ${originBookable.maxBookingDuration} Stunden nicht überschreiten.`,
    };
  }

  return {
    checkType: CHECK_TYPES.BOOKING_DURATION,
    available: true,
  };
}

/**
 * @param {Object} params
 * @returns {Object}
 */
function runBlockPeriodCheck({ originBookable, timeBegin, timeEnd }) {
  if (!originBookable?.isBlockPeriodRelated) {
    return { checkType: CHECK_TYPES.BLOCK_PERIOD, available: true };
  }

  if (!isBlockPeriodBookingValid(originBookable, timeBegin, timeEnd)) {
    throw {
      checkType: CHECK_TYPES.BLOCK_PERIOD,
      available: false,
      message: `Für das Objekt ${originBookable.title} muss eine vollständige Block-Periode gebucht werden.`,
    };
  }

  return { checkType: CHECK_TYPES.BLOCK_PERIOD, available: true };
}

/**
 * @param {Object} params
 * @returns {Object}
 */
function runTimePeriodCheck({ originBookable, timeBegin, timeEnd }) {
  if (!originBookable?.isTimePeriodRelated) {
    return { checkType: CHECK_TYPES.TIME_PERIOD, available: true };
  }

  if (!isTimePeriodBookingValid(originBookable, timeBegin, timeEnd)) {
    throw {
      checkType: CHECK_TYPES.TIME_PERIOD,
      available: false,
      message: `Für das Objekt ${originBookable.title} muss ein vollständiger Zeitslot gebucht werden.`,
    };
  }

  return { checkType: CHECK_TYPES.TIME_PERIOD, available: true };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runEventDateCheck({ provider, originBookable }) {
  if (
    originBookable.type !== BOOKABLE_TYPES.TICKET ||
    !originBookable.eventId
  ) {
    return {
      checkType: CHECK_TYPES.EVENT_DATE,
      available: true,
    };
  }

  const event = await resolve(provider.getEvent());

  if (!event) {
    throw {
      checkType: CHECK_TYPES.EVENT_DATE,
      available: false,
      message: `Die Veranstaltung für das Ticket ${originBookable.title} existiert nicht.`,
    };
  }

  if (!isEventBookable(event)) {
    throw {
      checkType: CHECK_TYPES.EVENT_DATE,
      available: false,
      message: `Die Veranstaltung ${event.information.name} liegt in der Vergangenheit und kann nicht mehr gebucht werden.`,
    };
  }

  return {
    checkType: CHECK_TYPES.EVENT_DATE,
    available: true,
  };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runMaxBookingDateCheck({ provider, originBookable, timeBegin }) {
  const tenant = await resolve(provider.getTenant());

  if (isWithinMaxBookingAdvance(timeBegin, tenant)) {
    return { checkType: CHECK_TYPES.MAX_BOOKING_DATE, available: true };
  }

  const maxBookingAdvanceInMonths = Number(tenant?.maxBookingAdvanceInMonths);

  throw {
    checkType: CHECK_TYPES.MAX_BOOKING_DATE,
    available: false,
    message: `Die Buchung für das Objekt ${originBookable.title} ist nur bis zu ${maxBookingAdvanceInMonths} Monate im Voraus möglich.`,
  };
}

/**
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function runMinBookingLeadTimeCheck({ originBookable, timeBegin }) {
  if (isWithinMinBookingLeadTime(timeBegin, originBookable)) {
    return { checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME, available: true };
  }

  const preparationLeadTimeMinutes = Number(
    originBookable.preparationLeadTimeMinutes,
  );

  throw {
    checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
    available: false,
    message: `Die Buchung für das Objekt ${originBookable.title} erfordert eine Vorbereitungszeit von ${preparationLeadTimeMinutes} Minuten innerhalb der Servicezeiten.`,
  };
}

module.exports = {
  getBookedAmountForBookableWindow,
  runPermissionCheck,
  runAvailabilityCheck,
  runParentAvailabilityCheck,
  runChildBookingsCheck,
  runEventSeatsCheck,
  runBookingDurationCheck,
  runBlockPeriodCheck,
  runTimePeriodCheck,
  runEventDateCheck,
  runMaxBookingDateCheck,
  runMinBookingLeadTimeCheck,
};
