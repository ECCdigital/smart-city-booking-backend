const OpeningHoursManager = require("../utilities/opening-hours-manager");
const BookingManager = require("../data-managers/booking-manager");
const {
  getBookingBufferMs,
  widenQueryWindow,
} = require("./booking-buffer");
const {
  isTimeRelatedBookable,
  sumBookedAmount,
  evaluateOriginCapacity,
  evaluateParentCapacity,
  evaluateChildCapacity,
  isTicketEventDateBookable,
  hasEventSeats,
  isDurationAllowed,
  hasBookingPermission,
  isWithinMaxBookingAdvance,
  isWithinMinBookingLeadTime,
  CAPACITY_MODES,
  isBlockPeriodBookingValid,
  isTimePeriodBookingValid,
  shouldSkipOpeningHoursCheck,
} = require("./availability-rules");

/**
 * @template T
 * @param {T|Promise<T>} value
 * @returns {Promise<T>}
 */
async function resolve(value) {
  return await value;
}

/**
 * @param {import("./providers/availability-data-provider").AvailabilityDataProvider} provider
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {Promise<import("../../entities/booking/booking").Booking[]>}
 */
async function getBookingsForCapacityCheck(
  provider,
  bookable,
  timeBegin,
  timeEnd,
  { useTimeOverlap = isTimeRelatedBookable(bookable) } = {},
) {
  if (useTimeOverlap) {
    const buffer = getBookingBufferMs(bookable);
    const queryWindow = widenQueryWindow(
      timeBegin,
      timeEnd,
      buffer.beforeMs,
      buffer.afterMs,
    );
    const bookings = await resolve(
      provider.getConcurrentBookings(
        bookable.id,
        queryWindow.timeBegin,
        queryWindow.timeEnd,
      ),
    );

    return BookingManager.filterConcurrentBookings(
      bookings,
      timeBegin,
      timeEnd,
      null,
      buffer,
    );
  }

  return resolve(provider.getRelatedBookings(bookable.id));
}

/**
 * @param {import("./providers/availability-data-provider").AvailabilityDataProvider} provider
 * @param {import("../../entities/bookable/bookable").Bookable} parentBookable
 * @param {import("../../entities/bookable/bookable").Bookable[]} childBookables
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {Promise<number>}
 */
async function sumChildTicketBookedAmount(
  provider,
  parentBookable,
  childBookables,
  timeBegin,
  timeEnd,
  useTimeOverlap,
) {
  let amountBooked = 0;

  for (const childBookable of childBookables) {
    const bookings = await getBookingsForCapacityCheck(
      provider,
      childBookable,
      timeBegin,
      timeEnd,
      { useTimeOverlap },
    );
    amountBooked += sumBookedAmount(bookings, childBookable.id);
  }

  return amountBooked;
}

/**
 * Evaluates checkout-aligned availability for a single booking window.
 *
 * @param {import("./providers/availability-data-provider").AvailabilityDataProvider} provider
 * @param {Object} params
 * @param {number} params.timeBegin
 * @param {number} params.timeEnd
 * @param {number} params.amount
 * @param {string|{ id: string }|null|undefined} [params.user]
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
async function checkWindowAvailability(
  provider,
  { timeBegin, timeEnd, amount, user },
) {
  const bookable = await resolve(provider.getBookable());
  const tenantId = await resolve(provider.getTenantId());
  const tenant = await resolve(provider.getTenant());
  const userId = user?.id ?? user;

  if (!bookable) {
    return { available: false, reason: "not-found" };
  }

  if (!(await hasBookingPermission(bookable, userId, tenantId))) {
    return { available: false, reason: "permission" };
  }

  if (isTimeRelatedBookable(bookable) && !shouldSkipOpeningHoursCheck(bookable)) {
    const parentBookables = await resolve(provider.getParentBookables());

    for (const candidate of [bookable, ...parentBookables]) {
      if (
        await OpeningHoursManager.hasOpeningHoursConflict(
          candidate,
          Number(timeBegin),
          Number(timeEnd),
        )
      ) {
        return { available: false, reason: "opening-hours" };
      }
    }
  }

  if (!isDurationAllowed(bookable, timeBegin, timeEnd)) {
    return { available: false, reason: "booking-duration" };
  }

  if (!isBlockPeriodBookingValid(bookable, timeBegin, timeEnd)) {
    return { available: false, reason: "block-period-mismatch" };
  }

  if (!isTimePeriodBookingValid(bookable, timeBegin, timeEnd)) {
    return { available: false, reason: "time-period-mismatch" };
  }

  const useTimeOverlap = isTimeRelatedBookable(bookable);

  const originBookings = await getBookingsForCapacityCheck(
    provider,
    bookable,
    timeBegin,
    timeEnd,
    { useTimeOverlap },
  );
  const originCapacity = evaluateOriginCapacity({
    bookings: originBookings,
    bookableId: bookable.id,
    capacity: bookable.amount,
    amount: Number(amount),
    mode: CAPACITY_MODES.ADDITIVE,
  });

  if (!originCapacity.available) {
    return { available: false, reason: "availability" };
  }

  const event = await resolve(provider.getEvent());
  if (!isTicketEventDateBookable(bookable, event)) {
    return { available: false, reason: "event-date" };
  }

  const eventBookings = await resolve(provider.getEventBookings());
  const eventSeats = hasEventSeats(
    eventBookings,
    bookable.eventId,
    tenantId,
    Number(amount),
    event?.attendees?.maxAttendees,
  );

  if (!eventSeats.available) {
    return { available: false, reason: "event-seats" };
  }

  const parentBookables = await resolve(provider.getParentBookables());
  const relatedBookables = await resolve(provider.getRelatedBookables());

  for (const parentBookable of parentBookables) {
    const parentBookings = await getBookingsForCapacityCheck(
      provider,
      parentBookable,
      timeBegin,
      timeEnd,
      { useTimeOverlap },
    );
    const { amountBooked: parentAmountBooked } = evaluateOriginCapacity({
      bookings: parentBookings,
      bookableId: parentBookable.id,
      capacity: parentBookable.amount || 1,
      amount: 0,
      mode: CAPACITY_MODES.ADDITIVE,
    });

    const isTicketChild = bookable.type === "ticket";
    const childTicketAmountBooked = isTicketChild
      ? await sumChildTicketBookedAmount(
          provider,
          parentBookable,
          await resolve(provider.getRelatedBookablesFor(parentBookable.id)),
          timeBegin,
          timeEnd,
          useTimeOverlap,
        )
      : 0;

    if (
      !evaluateParentCapacity({
        parentAmountBooked,
        childTicketAmountBooked,
        capacity: parentBookable.amount,
        requestedAmount: Number(amount),
        isTicketChild,
      })
    ) {
      return { available: false, reason: "parent-availability" };
    }
  }

  for (const childBookable of relatedBookables) {
    if (childBookable.id === bookable.id) {
      continue;
    }

    const childBookings = await getBookingsForCapacityCheck(
      provider,
      childBookable,
      timeBegin,
      timeEnd,
      { useTimeOverlap },
    );
    const { amountBooked: childAmountBooked } = evaluateOriginCapacity({
      bookings: childBookings,
      bookableId: childBookable.id,
      capacity: childBookable.amount || 1,
      amount: 0,
      mode: CAPACITY_MODES.ADDITIVE,
    });

    if (
      !evaluateChildCapacity({
        childAmountBooked,
        capacity: childBookable.amount,
        requestedAmount: Number(amount),
      })
    ) {
      return { available: false, reason: "child-bookings" };
    }
  }

  if (!isWithinMaxBookingAdvance(timeBegin, tenant)) {
    return { available: false, reason: "max-booking-date" };
  }

  if (!isWithinMinBookingLeadTime(timeBegin, bookable)) {
    return { available: false, reason: "insufficient-lead-time" };
  }

  return { available: true };
}

module.exports = {
  checkWindowAvailability,
  getBookingsForCapacityCheck,
};
