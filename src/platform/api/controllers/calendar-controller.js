const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  ItemCheckoutService,
} = require("../../../commons/services/checkout/item-checkout-service");
const {
  checkAvailability,
} = require("../../../commons/services/calendar-service");

/**
 * CalendarController class.
 *
 * This class is responsible for handling requests related to occupancies in the calendar.
 * It provides a static method `getOccupancies` which fetches occupancies for all bookables for a given tenant.
 * The occupancies are fetched asynchronously using worker threads, one for each bookable.
 * The results from all worker threads are combined into a single array of occupancies, which is then sent as the
 * response.
 */
class CalendarController {
  /**
   * Fetches occupancies for all bookables for a given tenant.
   * The occupancies are fetched asynchronously and combined into a single array.
   *
   * @async
   * @function getOccupancies
   * @param {Object} request - The HTTP request object containing tenant and bookable IDs.
   * @param {Object} response - The HTTP response object to send the result.
   * @returns {Promise<void>} - A promise that resolves when the occupancies are fetched and sent.
   */
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

      let bookings = await BookingManager.getRelatedBookingsBatch(
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
   * Asynchronously fetches the availability of a specific bookable item for a given tenant.
   *
   * @async
   * @function getBookableAvailability
   * @param {Object} request - The HTTP request object. The request should contain the tenant and bookable ID in the params, and optionally the amount, startDate, and endDate in the query.
   * @param {Object} response - The HTTP response object. The response will contain an array of availability periods for the specified bookable item within the specified time range.
   * @returns {void}
   *
   * @example
   * // GET /api/<tenant>/bookables/<bookableId>/availability?amount=1&startDate=2022-01-01&endDate=2022-01-07
   * CalendarController.getBookableAvailability(req, res);
   */
  static async getBookableAvailability(request, response) {
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
      const availability = await checkAvailability(
        tenant,
        bookableId,
        startDateQuery,
        endDateQuery,
        amount,
        user,
      );

      response.status(200).send(availability);
    } catch (error) {
      console.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
  }

  static getTimePeriodsPerHour(startDate, endDate, interval = 60000 * 60) {
    var timePeriodsArray = [];
    var currentDateTime = new Date(startDate);

    while (currentDateTime <= endDate) {
      var nextDateTime = new Date(currentDateTime.getTime() + interval);
      timePeriodsArray.push({
        timeBegin: currentDateTime.getTime(),
        timeEnd: nextDateTime.getTime(),
        available: false,
      });
      currentDateTime = nextDateTime;
    }

    return timePeriodsArray;
  }

  static async getBookableAvailabilityFixed(request, response) {
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

    const startDate = startDateQuery ? new Date(startDateQuery) : new Date();
    const endDate = endDateQuery
      ? new Date(endDateQuery)
      : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const periods = CalendarController.getTimePeriodsPerHour(
      startDate,
      endDate,
    );
    for (const p of periods) {
      let itemCheckoutService = null;

      try {
        itemCheckoutService = new ItemCheckoutService(
          user?.id,
          tenant,
          p.timeBegin,
          p.timeEnd,
          bookableId,
          Number(amount),
          null,
        );

        await itemCheckoutService.init();
        // in order to check calendar availability, we generally need to perform all checks of the checkout service.
        // EXCEPTION: we do not need to check minimum / maximum durations when checking fixed time periods
        await itemCheckoutService.checkPermissions();
        await itemCheckoutService.checkOpeningHours();
        await itemCheckoutService.checkAvailability();
        await itemCheckoutService.checkEventDate();
        await itemCheckoutService.checkEventSeats();
        await itemCheckoutService.checkParentAvailability();
        await itemCheckoutService.checkChildBookings();
        await itemCheckoutService.checkMaxBookingDate();
        p.available = true;
      } catch {
        p.available = false;
      } finally {
        if (itemCheckoutService) {
          itemCheckoutService.cleanup();
          itemCheckoutService = null;
        }
      }
    }

    periods.sort((a, b) => a.timeBegin - b.timeBegin);

    let combinedPeriods = [];
    let currentPeriod = periods[0];

    for (let i = 1; i < periods.length; i++) {
      if (periods[i].available === currentPeriod.available) {
        currentPeriod.timeEnd = periods[i].timeEnd;
      } else {
        combinedPeriods.push(currentPeriod);
        currentPeriod = periods[i];
      }
    }

    combinedPeriods.push(currentPeriod);

    response.status(200).send(combinedPeriods);
  }
}

module.exports = CalendarController;
