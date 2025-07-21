const { BookableManager } = require("../data-managers/bookable-manager");
const {
  ItemCheckoutService,
  CHECK_TYPES,
} = require("./checkout/item-checkout-service");
const bunyan = require("bunyan");

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
   * @param {Date} params.timeBegin - The start time of the occupancy check period.
   * @param {Date} params.timeEnd - The end time of the occupancy check period.
   * @param {string|null} [params.userId=null] - The identifier of the user requesting the occupancy, if applicable.
   * @return {Promise<Object>} A promise that resolves to an object containing occupancy details, including the bookable ID, title, and availability data. In case of an error, it returns an error response object.
   */
  static async getOccupancy({
    bookableId,
    tenantId,
    timeBegin,
    timeEnd,
    userId = null,
  }) {
    let checkoutService = null;
    try {
      const bookable = await BookableManager.getBookable(bookableId, tenantId);
      checkoutService = new ItemCheckoutService(
        userId,
        tenantId,
        timeBegin,
        timeEnd,
        bookableId,
        1,
        null,
        false,
      );

      await checkoutService.init(bookable);

      const occupancyData =
        await this._performAvailabilityCheck(checkoutService);

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

  /**
   * Performs an availability check using the provided checkout service and processes the results.
   *
   * @param {Object} checkoutService - The service used to perform the availability check. Must include a `checkAll` method and optionally a `hasEvent` flag.
   * @return {Promise<Object>} A promise that resolves to an object indicating availability status. If available, includes capacity details; otherwise, includes occupancy data or an unavailable response.
   */
  static async _performAvailabilityCheck(checkoutService) {
    try {
      const checkResults = await checkoutService.checkAll(false);
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
          ...occupancyData,
        };
      }

      const lowestAvailability = this._findLowestAvailability(
        checkResults,
        checkoutService.hasEvent,
      );

      return {
        isAvailable: true,
        totalCapacity: lowestAvailability?.totalCapacity ?? null,
        booked: lowestAvailability?.booked ?? null,
        remaining: lowestAvailability?.remaining ?? null,
      };
    } catch (error) {
      return this._createUnavailableResponse();
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
      case CHECK_TYPES.AVAILABILITY:
        return {
          totalCapacity: reasonObj.totalCapacity ?? null,
          booked: reasonObj.booked ?? null,
          remaining: reasonObj.remaining ?? null,
        };

      case CHECK_TYPES.PARENT_AVAILABILITY:
        if (
          reasonObj.parentAvailability &&
          reasonObj.parentAvailability.length > 0
        ) {
          const parentData = reasonObj.parentAvailability[0];
          return {
            totalCapacity: parentData.totalCapacity ?? null,
            booked: parentData.booked ?? null,
            remaining: parentData.remaining ?? null,
          };
        }
        break;

      case CHECK_TYPES.CHILD_BOOKINGS:
        if (
          reasonObj.childAvailability &&
          reasonObj.childAvailability.length > 0
        ) {
          const childData = reasonObj.childAvailability[0];
          return {
            totalCapacity: childData.totalCapacity ?? null,
            booked: childData.booked ?? null,
            remaining: childData.remaining ?? null,
          };
        }
        break;

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

    return availabilityChecks
      .filter((check) => check.remaining !== null)
      .reduce((lowest, current) => {
        return !lowest || current.remaining < lowest.remaining
          ? current
          : lowest;
      }, null);
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
