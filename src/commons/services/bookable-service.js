const { BookableManager } = require("../data-managers/bookable-manager");
const {
  ItemCheckoutService,
  CHECK_TYPES,
} = require("./checkout/item-checkout-service");
const bunyan = require("bunyan");
const ExternalPriceService = require("./external-price-service");

const logger = bunyan.createLogger({
  name: "bookable-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The BookableService class provides methods for determining the availability
 * and occupancy of bookable items within a specific time range.
 */
class BookableService {
  /**
   * Retrieves the occupancy information for a given bookable item within a specified time range.
   *
   * @param {Object} params - The parameters for retrieving occupancy information.
   * @param {string} params.bookableId - The unique identifier of the bookable item.
   * @param {string} params.tenantId - The identifier of the tenant requesting the occupancy.
   * @param {number} params.timeBegin - The start time of the occupancy check period.
   * @param {number} params.timeEnd - The end time of the occupancy check period.
   * @param {string|null} [params.userId=null] - The identifier of the user requesting the occupancy, if applicable.
   * @param {boolean} [ignoreRelatedEntities=false] - A flag indicating whether to only check the availability of the bookable item itself, ignoring related entities.
   * @return {Promise<Object>} A promise that resolves to an object containing occupancy details, including the bookable ID, title, and availability data. In case of an error, it returns an error response object.
   */
  static async getOccupancy({
    bookableId,
    tenantId,
    timeBegin,
    timeEnd,
    userId = null,
    ignoreRelatedEntities = false,
  }) {
    let checkoutService = null;
    try {
      const bookable = await BookableManager.getBookable(bookableId, tenantId);
      checkoutService = new ItemCheckoutService({
        user: userId,
        tenantId,
        timeBegin,
        timeEnd,
        bookableId,
        amount: 1,
        bookWithoutDiscount: false,
      });

      await checkoutService.init(bookable);

      const occupancyData = await this._performAvailabilityCheck(
        checkoutService,
        ignoreRelatedEntities,
      );

      return {
        bookableId,
        title: bookable.title,
        ...occupancyData,
      };
    } catch (error) {
      logger.error(error);
      return this._createErrorResponse(bookableId);
    } finally {
      if (checkoutService) {
        checkoutService.cleanup();
        checkoutService = null;
      }
    }
  }

  static async getPriceCategoriesForBookable(bookableId, tenantId) {
    const bookable = await BookableManager.getBookable(bookableId, tenantId);
    const extPrices = await ExternalPriceService.resolve(bookable, tenantId);
    if (extPrices) {
      return extPrices;
    } else {
      return bookable.priceCategories;
    }
  }

  /**
   * Performs an availability check using the provided checkout service and processes the results.
   *
   * @param {Object} checkoutService - The service used to perform the availability check. Must include a `checkAll` method and optionally a `hasEvent` flag.
   * @param {boolean} ignoreRelatedEntities - A flag indicating whether to only check the availability of the bookable item itself, ignoring related entities.
   * @return {Promise<Object>} A promise that resolves to an object indicating availability status. If available, includes capacity details; otherwise, includes occupancy data or an unavailable response.
   */
  static async _performAvailabilityCheck(
    checkoutService,
    ignoreRelatedEntities = false,
  ) {
    try {
      let checkResults = [];
      if (ignoreRelatedEntities) {
        // Only check the availability of the bookable itself.
        checkResults = await Promise.allSettled([
          await checkoutService.checkAvailability(),
        ]);
      } else {
        checkResults = await checkoutService.checkAll(false);
      }

      const availabilityCheck =
        checkResults.find(
          (result) =>
            result.status === "fulfilled" &&
            result.value &&
            result.value.checkType === CHECK_TYPES.AVAILABILITY,
        )?.value ||
        checkResults.find(
          (result) =>
            result.status === "rejected" &&
            result.reason &&
            result.reason.checkType === CHECK_TYPES.AVAILABILITY,
        )?.reason;
      if (!checkResults || !Array.isArray(checkResults)) {
        return this._createUnavailableResponse();
      }

      const failedCheck = checkResults.find(
        (result) => result.status === "rejected",
      );

      if (failedCheck) {
        const occupancyData = this._extractOccupancyFromFailedCheck(
          failedCheck.reason,
        );

        return {
          isAvailable: false,
          totalCapacity: availabilityCheck?.totalCapacity ?? null,
          booked: availabilityCheck?.booked ?? null,
          remaining: availabilityCheck?.remaining ?? null,
          reason: occupancyData.reason,
          failedCheck: occupancyData,
        };
      }

      return {
        isAvailable: availabilityCheck?.available ?? false,
        totalCapacity: availabilityCheck?.totalCapacity ?? null,
        booked: availabilityCheck?.booked ?? null,
        remaining: availabilityCheck?.remaining ?? null,
      };
    } catch (error) {
      const occupancyData = this._extractOccupancyFromFailedCheck(error);

      return {
        isAvailable: false,
        ...occupancyData,
      };
    }
  }

  /**
   * Extracts occupancy data such as total capacity, booked, and remaining values from a failed check based on the reason object and its check type.
   *
   * @param {Object} reasonObj - The object containing details about the failed check, including check type and occupancy-related data.
   * @return {Object} An object containing the extracted occupancy values:
   * - totalCapacity: The total capacity or null if unavailable.
   * - booked: The number of booked units or null if unavailable.
   * - remaining: The number of remaining units or null if unavailable.
   */
  static _extractOccupancyFromFailedCheck(reasonObj) {
    switch (reasonObj.checkType) {
      case CHECK_TYPES.EVENT_SEATS:
        return {
          eventId: reasonObj.eventId ?? null,
          title: reasonObj.title ?? null,
          totalCapacity: reasonObj.totalCapacity ?? null,
          booked: reasonObj.booked ?? null,
          remaining: reasonObj.remaining ?? null,
          reason: reasonObj.checkType ?? null,
        };
      case CHECK_TYPES.AVAILABILITY:
        return {
          bookableId: reasonObj.bookableId ?? null,
          title: reasonObj.title ?? null,
          totalCapacity: reasonObj.totalCapacity ?? null,
          booked: reasonObj.booked ?? null,
          remaining: reasonObj.remaining ?? null,
          reason: reasonObj.checkType ?? null,
        };

      case CHECK_TYPES.PARENT_AVAILABILITY:
        if (
          reasonObj.parentAvailability &&
          reasonObj.parentAvailability.length > 0
        ) {
          const parentData = reasonObj.parentAvailability.find(
            (avail) => avail.available === false,
          );
          return {
            bookableId: parentData.bookableId ?? null,
            title: parentData.title ?? null,
            totalCapacity: parentData.totalCapacity ?? null,
            booked: parentData.booked ?? null,
            remaining: parentData.remaining ?? null,
            reason: reasonObj.checkType ?? null,
          };
        }
        break;

      case CHECK_TYPES.CHILD_BOOKINGS:
        if (
          reasonObj.childAvailabilities &&
          reasonObj.childAvailabilities.length > 0
        ) {
          const childData = reasonObj.childAvailabilities.find(
            (avail) => avail.available === false,
          );
          return {
            bookableId: childData.bookableId ?? null,
            title: childData.title ?? null,
            totalCapacity: childData.totalCapacity ?? null,
            booked: childData.booked ?? null,
            remaining: childData.remaining ?? null,
            reason: reasonObj.checkType ?? null,
          };
        }
        break;
      case CHECK_TYPES.EVENT_DATE:
        return {
          eventId: reasonObj.eventId ?? null,
          title: reasonObj.title ?? null,
          totalCapacity: reasonObj.totalCapacity ?? null,
          reason: reasonObj.checkType ?? null,
        };

      case CHECK_TYPES.TIME_RELATION:
        return {
          bookableId: reasonObj.bookableId ?? null,
          title: reasonObj.title ?? null,
          reason: reasonObj.checkType ?? null,
        };

      case CHECK_TYPES.BOOKING_DURATION:
        return {
          bookableId: reasonObj.bookableId ?? null,
          title: reasonObj.title ?? null,
          reason: reasonObj.checkType ?? null,
        };

      default:
        break;
    }

    return {
      totalCapacity: null,
      booked: null,
      remaining: null,
    };
  }

  /**
   * Finds the lowest availability check from the provided check results.
   *
   * @param {Array} checkResults - An array of check result objects.
   * @param {boolean} hasEvent - A boolean indicating whether the check is associated with an event.
   * @return {Object|null} The check result object with the lowest availability or null if no valid checks are found.
   */
  static _findLowestAvailability(checkResults, hasEvent) {
    const availabilityChecks = this._extractAvailabilityChecks(
      checkResults,
      hasEvent,
    );

    const lowestCheck = availabilityChecks
      .filter(
        (check) =>
          check.remaining !== null &&
          check.checkType !== CHECK_TYPES.PARENT_AVAILABILITY,
      )
      .reduce((lowest, current) => {
        return !lowest || current.remaining < lowest.remaining
          ? current
          : lowest;
      }, null);

    if (lowestCheck) {
      return lowestCheck;
    } else {
      return (
        availabilityChecks.filter(
          (check) => check.checkType === CHECK_TYPES.AVAILABILITY,
        )[0] || null
      );
    }
  }

  /**
   * Extracts and consolidates availability checks from the provided check results.
   *
   * @param {Array<Object>} checkResults - An array of check result objects, each containing information about availability statuses and types.
   * @param {boolean} hasEvent - A flag indicating whether event-related availability should be included in the checks.
   * @return {Array<Object>} An array of extracted availability check objects that match the specified criteria.
   */
  static _extractAvailabilityChecks(checkResults, hasEvent) {
    const checks = [];

    const fulfilledResults = checkResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const parentCheck = fulfilledResults.find(
      ({ checkType }) => checkType === CHECK_TYPES.PARENT_AVAILABILITY,
    );
    if (parentCheck?.parentAvailabilities) {
      checks.push(...parentCheck.parentAvailabilities);
    }

    const childCheck = fulfilledResults.find(
      ({ checkType }) => checkType === CHECK_TYPES.CHILD_BOOKINGS,
    );
    if (childCheck?.childAvailabilities) {
      checks.push(...childCheck.childAvailabilities);
    }

    const bookableCheck = fulfilledResults.find(
      ({ checkType }) => checkType === CHECK_TYPES.AVAILABILITY,
    );
    if (bookableCheck) {
      checks.push(bookableCheck);
    }

    if (hasEvent) {
      const eventSeatsCheck = fulfilledResults.find(
        ({ checkType }) => checkType === CHECK_TYPES.EVENT_SEATS,
      );
      if (eventSeatsCheck) {
        checks.push(eventSeatsCheck);
      }
    }

    return checks;
  }

  static _createUnavailableResponse() {
    return {
      isAvailable: false,
      totalCapacity: null,
      booked: null,
      remaining: null,
    };
  }

  static _createErrorResponse(bookableId) {
    return {
      bookableId,
      title: null,
      isAvailable: false,
      totalCapacity: null,
      booked: null,
      remaining: null,
    };
  }
}

module.exports = BookableService;
