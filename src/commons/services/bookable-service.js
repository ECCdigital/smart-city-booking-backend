const { BookableManager } = require("../data-managers/bookable-manager");
const {
  ItemCheckoutService,
  CHECK_TYPES,
} = require("./checkout/item-checkout-service");
const bunyan = require("bunyan");
const ExternalPriceService = require("./external-price-service");
const { DOMAIN } = require("./authorization/reach");
const RateLimiter = require("./rate-limit/rate-limiter");
const { periodOccupancyPerIp } = require("./rate-limit/limits");

const logger = bunyan.createLogger({
  name: "bookable-service.js",
  level: process.env.LOG_LEVEL,
});

/** How many bookables `getPeriodOccupancies` checks at once. */
const PERIOD_CHECK_CONCURRENCY = 5;

/** The `reason` of a bookable whose checks could not run. */
const PERIOD_ERROR_REASON = "error";

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
    try {
      const bookable = await BookableManager.getBookable(
        bookableId,
        tenantId,
        DOMAIN,
      );
      return await this._withCheckout(
        { bookable, bookableId, tenantId, timeBegin, timeEnd, userId },
        async (checkoutService) => ({
          bookableId,
          title: bookable.title,
          ...(await this._performAvailabilityCheck(
            checkoutService,
            ignoreRelatedEntities,
          )),
        }),
      );
    } catch (error) {
      logger.error(error);
      return this._createErrorResponse(bookableId);
    }
  }

  /**
   * Runs `use` with the checkout of one unit of a loaded bookable in a
   * period, as the single and the batch occupancy check it, and cleans the
   * checkout up afterwards.
   *
   * @param {Object} params
   * @param {Bookable|null} params.bookable - The bookable, read whole.
   * @param {string} [params.bookableId=params.bookable.id]
   * @param {string} params.tenantId
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   * @param {string|null} params.userId
   * @param {Map} [params.externalCache]
   * @param {Map} [params.requestCache]
   * @param {function(ItemCheckoutService): Promise<*>} use
   * @return {Promise<*>} What `use` answers.
   */
  static async _withCheckout(
    {
      bookable,
      bookableId = bookable?.id,
      tenantId,
      timeBegin,
      timeEnd,
      userId,
      externalCache,
      requestCache,
    },
    use,
  ) {
    let checkoutService = null;
    try {
      checkoutService = new ItemCheckoutService({
        user: userId,
        tenantId,
        timeBegin,
        timeEnd,
        bookableId,
        amount: 1,
        bookWithoutDiscount: false,
        externalCache,
        requestCache,
      });
      await checkoutService.init(bookable);
      return await use(checkoutService);
    } finally {
      if (checkoutService) {
        checkoutService.cleanup();
        checkoutService = null;
      }
    }
  }

  /**
   * The occupancy of many bookables in one period, each with the price of
   * that period where it is available - what the storefront's search with a
   * period asks, in one request instead of two per bookable. Each bookable
   * is checked as `getOccupancy` checks it; the price is the one
   * `validateItem` answers for one unit. A refusal names its check in
   * `reason`, a bookable whose checks could not run answers `reason: "error"`.
   *
   * Each distinct id counts at the limit per IP first, as it runs one
   * checkout (ECCdigital/tickets#1254): past it nothing is looked up and
   * the request spends nothing.
   *
   * @param {Object} params
   * @param {string[]} params.bookableIds - The ids the request asks for.
   * @param {string} params.ip - The client IP the limit counts against.
   * @param {string} params.tenantId
   * @param {{reach: string, userId?: string|null}} params.scope - The reach
   *   of the request: ids outside it are left out, as the single occupancy
   *   answers them 404.
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   * @param {string|null} [params.userId=null]
   * @return {Promise<Object[]>} One entry per bookable found.
   */
  static async getPeriodOccupancies({
    bookableIds,
    ip,
    tenantId,
    scope,
    timeBegin,
    timeEnd,
    userId = null,
  }) {
    const ids = [...new Set(bookableIds)];
    await RateLimiter.enforce({
      ...periodOccupancyPerIp(ip),
      cost: ids.length,
    });

    // One read: the bookables within the reach of the request, each whole,
    // as the checkout of `getOccupancy` reads it.
    const bookables = await BookableManager.getWholeBookablesByIds(
      tenantId,
      ids,
      scope,
    );
    // A pool, not rounds: each worker takes the next bookable as soon as
    // its own is done, so one slow external provider holds one slot and
    // not the four beside it. `_getPeriodOccupancy` never throws.
    const results = new Array(bookables.length);
    // One cache of the external providers for the whole request, as
    // `CalendarService.checkAvailability` keeps one: bookables on the same
    // IFBS location or Pareva unit ask the provider once.
    const externalCache = new Map();
    // And one of the membership, the tenant and its apps, which every
    // checkout of the request reads alike.
    const requestCache = new Map();
    let next = 0;
    const worker = async () => {
      while (next < bookables.length) {
        const index = next++;
        results[index] = await this._getPeriodOccupancy({
          bookable: bookables[index],
          tenantId,
          timeBegin,
          timeEnd,
          userId,
          externalCache,
          requestCache,
        });
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PERIOD_CHECK_CONCURRENCY, bookables.length) },
        worker,
      ),
    );
    return results;
  }

  static async _getPeriodOccupancy({
    bookable,
    tenantId,
    timeBegin,
    timeEnd,
    userId,
    externalCache,
    requestCache,
  }) {
    try {
      return await this._withCheckout(
        {
          bookable,
          tenantId,
          timeBegin,
          timeEnd,
          userId,
          externalCache,
          requestCache,
        },
        async (checkoutService) => {
          const checkResults = await checkoutService.checkAll(false);

          // A check that refuses names its type. One that throws (a
          // provider down, a tenant without its app) names none and says
          // nothing about the period: unless another check refuses, that
          // is an error, not a booked-out bookable.
          const rejected = checkResults.filter((r) => r.status === "rejected");
          const refusal = rejected.find((r) => r.reason?.checkType);
          if (rejected.length > 0 && !refusal) {
            rejected.forEach((r) => logger.error(r.reason));
            return this._periodError(bookable);
          }

          const { isAvailable, totalCapacity, booked, remaining } =
            this._occupancyOfCheckResults(checkResults);

          // Only the documented fields: a failed check names the parent or
          // child that failed (`failedCheck`, `bookableId`, `title`), which
          // may be one the request cannot reach.
          return {
            bookableId: bookable.id,
            title: bookable.title,
            isAvailable,
            totalCapacity,
            booked,
            remaining,
            ...(refusal ? { reason: refusal.reason.checkType } : {}),
            price: isAvailable
              ? await this._periodPrice(checkoutService)
              : null,
          };
        },
      );
    } catch (error) {
      logger.error(error);
      return this._periodError(bookable);
    }
  }

  /** A bookable whose checks could not run: no answer about the period. */
  static _periodError(bookable) {
    return {
      bookableId: bookable.id,
      title: bookable.title,
      isAvailable: false,
      totalCapacity: null,
      booked: null,
      remaining: null,
      reason: PERIOD_ERROR_REASON,
      price: null,
    };
  }

  /** The price of one unit in the period, as `validateItem` answers it; null where none can be found. */
  static async _periodPrice(checkoutService) {
    try {
      return await checkoutService.priceFields();
    } catch (error) {
      logger.warn(error);
      return null;
    }
  }

  static async getPriceCategoriesForBookable(bookableId, tenantId) {
    const bookable = await BookableManager.getBookable(
      bookableId,
      tenantId,
      DOMAIN,
    );
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

      return this._occupancyOfCheckResults(checkResults);
    } catch (error) {
      const occupancyData = this._extractOccupancyFromFailedCheck(error);

      return {
        isAvailable: false,
        ...occupancyData,
      };
    }
  }

  /**
   * The occupancy a list of settled checks (`checkAll(false)`) amounts to.
   * Throws where the list is not one, as `_performAvailabilityCheck` expects.
   *
   * @param {PromiseSettledResult[]} checkResults
   * @return {Object} As `_performAvailabilityCheck`.
   */
  static _occupancyOfCheckResults(checkResults) {
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
      // A refusing parent or child may be one the request cannot reach:
      // the single occupancy is public, so `failedCheck` leaves out which
      // bookable refused and keeps only its numbers.
      const occupancyData = this._extractOccupancyFromFailedCheck(
        failedCheck.reason,
      );
      delete occupancyData.bookableId;
      delete occupancyData.title;

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

      case CHECK_TYPES.PARENT_AVAILABILITY: {
        // `runParentAvailabilityCheck` marks the refusing parent with
        // `isAvailable: false` in `parentAvailability`.
        const parentData =
          (reasonObj.parentAvailability ?? []).find(
            (avail) => avail.isAvailable === false,
          ) ?? {};
        return {
          bookableId: parentData.bookableId ?? null,
          title: parentData.title ?? null,
          totalCapacity: parentData.totalCapacity ?? null,
          booked: parentData.booked ?? null,
          remaining: parentData.remaining ?? null,
          reason: reasonObj.checkType ?? null,
        };
      }

      case CHECK_TYPES.CHILD_BOOKINGS:
        // `runChildBookingsCheck` names the refusing child on the refusal itself.
        return {
          bookableId: reasonObj.bookableId ?? null,
          title: reasonObj.title ?? null,
          totalCapacity: reasonObj.totalCapacity ?? null,
          booked: reasonObj.booked ?? null,
          remaining: reasonObj.remaining ?? null,
          reason: reasonObj.checkType ?? null,
        };
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
