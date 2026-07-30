const { BookableManager } = require("../../data-managers/bookable-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const OpeningHoursManager = require("../../utilities/opening-hours-manager");
const bunyan = require("bunyan");
const { getTenantAppById } = require("../../data-managers/tenant-manager");
const HolidaysService = require("../holiday/holidays-service");
const { formatISO } = require("date-fns");
const {
  BOOKABLE_TYPES,
  Bookable,
} = require("../../entities/bookable/bookable");
const CouponService = require("../coupon-service");
const providerRegistry = require("./providers/checkout-provider-registry");
const { createClient } = require("../locker/clients/locker-client-registry");
const { CHECK_TYPES } = require("../../availability/checkout-check-types");
const { CheckoutDataProvider } = require("../../availability/providers");
const {
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
} = require("../../availability/checkout-availability-checks");
const {
  isTimeRelatedBookable,
  shouldSkipOpeningHoursCheck,
} = require("../../availability/availability-rules");
const { CheckoutPermissions } = require("./checkout-permissions");
const { log } = require("qrcode/lib/core/galois-field");

const logger = bunyan.createLogger({
  name: "item-checkout-service.js",
  level: process.env.LOG_LEVEL,
});

class ItemCheckoutService {
  /**
   * Creates an instance of CheckoutManager.
   *
   * @param {Object} user The user object
   * @param {string} tenantId The tenant ID
   * @param {number} timeBegin The timestamp of the beginning of the booking
   * @param {number} timeEnd The timestamp of the end of the booking
   * @param {string} bookableId The ID of the bookable
   * @param {number} amount The amount of the booking
   * @param {string || null} couponCode The coupon code
   * @param {boolean} bookWithoutDiscount When true, booking discounts are ignored and the full price applies.
   * @param {string} checkoutId The ID of the checkout process, used for correlating logs and operations. Optional.
   * @param {string|string[]|null} [excludeBookingIds] Booking IDs to ignore in capacity checks (e.g. the booking being edited).
   * @param {Map} externalCache An optional Map instance for caching data across multiple service instances, particularly useful for external provider data. If not provided, a new Map will be created for each instance.
   *                                Defaults to `false` (discounts are applied when configured).
   */
  constructor({
    user,
    tenantId,
    timeBegin,
    timeEnd,
    bookableId,
    amount,
    couponCode,
    bookWithoutDiscount,
    checkoutId,
    excludeBookingIds,
    externalCache,
  }) {
    this.user = user;
    this.tenantId = tenantId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.bookableId = bookableId;
    this.amount = Number(amount);
    this.couponCode = couponCode;
    this.originBookable = null;
    this.bookWithoutDiscount = bookWithoutDiscount ?? false;
    this.checkoutId = checkoutId;
    this.excludeBookingIds = Array.isArray(excludeBookingIds)
      ? excludeBookingIds.filter(Boolean)
      : excludeBookingIds
        ? [excludeBookingIds]
        : [];
    this.externalCache = externalCache || new Map();
    this._cache = new Map();
    this._availabilityProvider = null;
  }

  _cached(key, fn) {
    if (!this._cache.has(key)) {
      this._cache.set(key, fn());
    }
    return this._cache.get(key);
  }

  /**
   * Asynchronously initializes the instance by fetching the bookable data.
   *
   * @async
   * @function init
   * @param {Object} [originBookable={}] - The bookable object to initialize with.
   * @returns {Promise<void>} - A promise that resolves when the initialization is complete.
   */
  async init(originBookable = {}) {
    this.originBookable = await this.getBookable();
    this.externalProviders = await this._resolveExternalProviders();
  }

  /**
   * Resolves external providers from lockerDetails + tenant config.
   * @returns {Promise<BaseCheckoutProvider[]>}
   */
  async _resolveExternalProviders() {
    const declarations = this.originBookable.externalProviders || [];

    if (!declarations.length) return [];

    const providers = [];

    for (const decl of declarations) {
      if (!providerRegistry.has(decl.provider)) {
        logger.warn(
          `Unknown external provider "${decl.provider}" on bookable ${this.bookableId}`,
        );
        continue;
      }

      if (decl.active === false) {
        continue;
      }

      const app = await getTenantAppById(this.tenantId, decl.provider);

      if (!app || !app.active) {
        throw new Error(
          `Tenant ${this.tenantId} has no active app for provider "${decl.provider}"`,
        );
      }

      const client = createClient(app);

      providers.push(
        providerRegistry.resolve(decl.provider, client, {
          userID: this.checkoutId,
          bookable: this.originBookable,
          unit: decl.config,
          timeBegin: this.timeBegin,
          timeEnd: this.timeEnd,
          amount: this.amount,
          tenantId: this.tenantId,
          externalCache: this.externalCache,
        }),
      );
    }

    return providers;
  }

  cleanup() {
    this.user = null;
    this.tenantId = null;
    this.timeBegin = null;
    this.timeEnd = null;
    this.bookableId = null;
    this.amount = null;
    this.couponCode = null;
    this.originBookable = null;
    this.bookWithoutDiscount = null;
    this.excludeBookingIds = [];
    this._availabilityProvider = null;
    this._cache.clear();
  }

  async _getAvailabilityProvider() {
    if (!this._availabilityProvider) {
      this._availabilityProvider =
        await CheckoutDataProvider.fromCheckoutService(this);
    }

    return this._availabilityProvider;
  }

  async _availabilityParams() {
    return {
      provider: await this._getAvailabilityProvider(),
      originBookable: this.originBookable,
      amount: this.amount,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      userId: this.user,
      excludeBookingIds: this.excludeBookingIds,
    };
  }

  get bookableUsed() {
    return this.originBookable;
  }

  get hasEvent() {
    return (
      this.originBookable.type === BOOKABLE_TYPES.TICKET &&
      !!this.originBookable.eventId
    );
  }

  get ignoreAmount() {
    return (
      (this.originBookable.priceType === "per-item" &&
        this.getPriceCategory()?.fixedPrice) ||
      (this.originBookable.priceType === "per-square-meter" &&
        this.getPriceCategory()?.fixedPrice)
    );
  }

  /**
   * Whether any external provider controls pricing.
   */
  get hasExternalPricing() {
    return this.originBookable.hasExternalPricing;
  }

  /**
   * Whether any external provider controls availability.
   */
  get hasExternalAvailability() {
    return this.originBookable.hasExternalAvailability;
  }

  /**
   * Whether any external provider controls max-amount validation.
   */
  get hasExternalMaxAmount() {
    return this.originBookable.hasExternalMaxAmount;
  }

  /**
   * Whether any external provider controls booking duration.
   */
  get hasExternalBookingDuration() {
    return this.originBookable.hasExternalBookingDuration;
  }

  async bookingDiscountPercent() {
    return this._cached("bookingDiscountPercent", async () => {
      if (!this.user || this.originBookable.tenantId !== this.tenantId) {
        return 0;
      }

      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        this.tenantId,
        this.user,
      );
      const userRoles = membership?.roles || [];

      return this.originBookable.getUserDiscountPercent(this.user, userRoles);
    });
  }

  async freeBookingAllowed() {
    return (await this.bookingDiscountPercent()) >= 100;
  }

  async calculateAmountBooked(bookable) {
    const provider = await this._getAvailabilityProvider();
    const { amountBooked, bookings } = await getBookedAmountForBookableWindow(
      provider,
      this.originBookable,
      bookable,
      this.timeBegin,
      this.timeEnd,
      this.excludeBookingIds,
    );

    return {
      amountBooked,
      bookings: bookings.map((booking) => ({
        id: booking.id,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
      })),
    };
  }

  async calculateAmountBookedTicketsByParent(parentBookable) {
    const provider = await this._getAvailabilityProvider();
    const childBookables = await provider.getRelatedBookablesFor(
      parentBookable.id,
    );

    let amountBooked = 0;
    for (const childBookable of childBookables) {
      const result = await getBookedAmountForBookableWindow(
        provider,
        this.originBookable,
        childBookable,
        this.timeBegin,
        this.timeEnd,
        this.excludeBookingIds,
      );
      amountBooked += result.amountBooked;
    }

    return amountBooked;
  }

  async getBookable() {
    return await BookableManager.getBookable(this.bookableId, this.tenantId);
  }

  /**
   * This method returns the booking duration in minutes.
   * @returns {number}
   */
  getBookingDuration(segmentStart, segmentEnd) {
    const start = segmentStart || this.timeBegin;
    const end = segmentEnd || this.timeEnd;

    if (!start || !end) {
      return 0;
    }
    return Math.round((end - start) / 60000);
  }

  async isTimeRelated() {
    return isTimeRelatedBookable(this.originBookable);
  }

  async _isLongRange() {
    return this.originBookable.isLongRange === true;
  }

  async priceValueAddedTax() {
    return this._cached("priceValueAddedTax", async () => {
      return (this.originBookable.priceValueAddedTax || 0) / 100;
    });
  }

  async regularPriceEur() {
    return this._cached("regularPriceEur", async () => {
      if (this.hasExternalPricing) {
        return await this._externalRegularPriceEur();
      }
      return await this._internalRegularPriceEur();
    });
  }

  async _externalRegularPriceEur() {
    if (this.hasExternalPricing) {
      let total = 0;
      for (const provider of this.externalProviders) {
        if (provider.handlesPricing) {
          total += await provider.getPriceEur();
        }
      }
      return Math.round(total * 100) / 100;
    }
  }

  async _internalRegularPriceEur() {
    const segments = this._splitIntoDailySegments();

    const prices = [];

    for (const segment of segments) {
      const priceCategory = this.getPriceCategory(segment.start, segment.end);

      let multiplier;
      if (!priceCategory?.fixedPrice) {
        switch (this.originBookable.priceType) {
          case "per-hour":
            multiplier =
              this.getBookingDuration(segment.start, segment.end) / 60;
            break;
          case "per-day":
            multiplier =
              this.getBookingDuration(segment.start, segment.end) / 1440;
            break;
          default:
            multiplier = 1;
        }
      } else {
        multiplier = 1;
      }

      if (!priceCategory) {
        throw {
          checkType: CHECK_TYPES.PRICE_CATEGORY,
          available: false,
          message: `Es konnte keine passende Preiskategorie für das Objekt ${this.originBookable.title} gefunden werden.`,
        };
      }

      prices.push((Number(priceCategory.priceEur) || 0) * multiplier);
    }

    let total;
    if (
      this.originBookable.priceType === "per-square-meter" ||
      this.originBookable.priceType === "per-item"
    ) {
      total = Math.max(...prices);
    } else {
      total = prices.reduce((acc, price) => acc + price, 0);
    }

    return Math.round(total * 100) / 100;
  }

  getPriceCategory(segmentStart, segmentEnd) {
    const { priceCategories, priceType } = this.originBookable;

    const start = segmentStart || this.timeBegin;
    const end = segmentEnd || this.timeEnd;

    if (priceCategories.length === 1 || (!start && !end)) {
      return priceCategories[0];
    }

    const dayBegin = new Date(start).getDay();
    const dayEnd = new Date(end).getDay();

    const bookingYear = new Date(start).getFullYear();
    const bookingDate = formatISO(new Date(start)).split("T")[0];

    const holidaysPriceCategories = priceCategories.filter(
      (pc) => pc.holidays.length > 0,
    );

    const filterdHolidayPriceCategories = [];
    const holidaysServiceCache = new Map();
    for (const pc of holidaysPriceCategories) {
      for (const holiday of pc.holidays) {
        const cacheKey = `${holiday.countryCode}-${holiday.stateCode}`;
        let hs = holidaysServiceCache.get(cacheKey);
        if (!hs) {
          hs = new HolidaysService({
            countryCode: holiday.countryCode,
            stateCode: holiday.stateCode,
          });
          holidaysServiceCache.set(cacheKey, hs);
        }
        const holidays = hs.getHolidays(bookingYear);
        const holidayDate = holidays.find((h) => h.name === holiday.name);
        if (
          holidayDate &&
          formatISO(new Date(holidayDate.date)).split("T")[0] === bookingDate
        ) {
          filterdHolidayPriceCategories.push(pc);
        }
      }
    }

    const filteredWeekdaysPriceCategories = priceCategories.filter((pc) => {
      if (dayBegin !== dayEnd) {
        return pc.weekdays.includes(dayBegin) || pc.weekdays.includes(dayEnd);
      } else {
        return pc.weekdays.includes(dayBegin);
      }
    });

    let priceCategoriesToCheck;

    if (filterdHolidayPriceCategories.length > 0) {
      priceCategoriesToCheck = filterdHolidayPriceCategories;
    } else if (filteredWeekdaysPriceCategories.length > 0) {
      priceCategoriesToCheck = filteredWeekdaysPriceCategories;
    } else {
      priceCategoriesToCheck = priceCategories.filter(
        (pc) => pc.weekdays.length === 0 && pc.holidays.length === 0,
      );
    }

    const bookingDurationInMinutes = this.getBookingDuration();

    let valueToCheck;
    switch (priceType) {
      case "per-hour":
        valueToCheck = bookingDurationInMinutes / 60;
        break;
      case "per-day":
        valueToCheck = bookingDurationInMinutes / 60 / 24;
        break;
      case "per-item":
        valueToCheck = this.amount;
        break;
      case "per-square-meter":
        valueToCheck = this.amount;
        break;
      default:
        return null;
    }

    const category = priceCategoriesToCheck.find(({ interval }) => {
      const { start, end } = interval;
      return (
        (start === null || start === "" || start <= valueToCheck) &&
        (end === null || end === "" || end >= valueToCheck)
      );
    });

    return category ?? null;
  }

  async regularGrossPriceEur() {
    return this._cached("regularGrossPriceEur", async () => {
      if (this.hasExternalPricing) {
        return await this._externalRegularGrossPriceEur();
      }
      return await this._internalRegularGrossPriceEur();
    });
  }

  async _externalRegularGrossPriceEur() {
    let total = 0;
    for (const provider of this.externalProviders) {
      if (provider.handlesPricing) {
        total += await provider.getGrossPriceEur();
      }
    }
    return Math.round(total * 100) / 100;
  }

  async _internalRegularGrossPriceEur() {
    const price =
      (await this.regularPriceEur()) * (1 + (await this.priceValueAddedTax()));
    return Math.round(price * 100) / 100;
  }

  async _userPricesAfterCoupons() {
    return this._cached("userPricesAfterCoupons", async () => {
      let netPrice = await this.regularPriceEur();

      const discountPercent = await this.bookingDiscountPercent();
      if (discountPercent > 0 && !this.bookWithoutDiscount) {
        netPrice = Math.max(
          0,
          Math.round(netPrice * (1 - discountPercent / 100) * 100) / 100,
        );
      }

      return CouponService.applyCouponToCheckoutPrices(
        this.originBookable.enableCoupons ? this.couponCode : null,
        this.tenantId,
        netPrice,
        await this.priceValueAddedTax(),
      );
    });
  }

  async userPriceEur() {
    const { netPrice } = await this._userPricesAfterCoupons();
    return netPrice;
  }

  async userGrossPriceEur() {
    const { grossPrice } = await this._userPricesAfterCoupons();
    return grossPrice;
  }

  async checkPermissions() {
    const provider = await this._getAvailabilityProvider();
    return runPermissionCheck({
      provider,
      originBookable: this.originBookable,
      userId: this.user,
    });
  }

  async checkAvailability() {
    if (this.hasExternalAvailability) {
      return await this._checkExternalAvailability();
    }
    return runAvailabilityCheck(await this._availabilityParams());
  }

  async _checkExternalAvailability() {
    for (const provider of this.externalProviders) {
      if (!provider.handlesAvailability) continue;

      const result = await provider.checkAvailability();

      if (!result.available) {
        throw {
          checkType: CHECK_TYPES.AVAILABILITY,
          available: false,
          message:
            result.message ||
            `${this.originBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
          externalSource: true,
          ...result,
        };
      }
    }

    return {
      checkType: CHECK_TYPES.AVAILABILITY,
      available: true,
      externalSource: true,
    };
  }

  async checkParentAvailability() {
    return runParentAvailabilityCheck(await this._availabilityParams());
  }

  async checkChildBookings() {
    return runChildBookingsCheck(await this._availabilityParams());
  }

  async checkEventSeats() {
    const provider = await this._getAvailabilityProvider();
    return runEventSeatsCheck({
      provider,
      originBookable: this.originBookable,
      amount: this.amount,
    });
  }

  async checkBookingDuration() {
    const durationMinutes = this.getBookingDuration();

    if (this.hasExternalBookingDuration) {
      for (const provider of this.externalProviders) {
        if (!provider.handlesBookingDuration) continue;

        const result = await provider.checkBookingDuration(durationMinutes);

        if (!result.available) {
          throw {
            checkType: CHECK_TYPES.BOOKING_DURATION,
            bookableId: this.originBookable.id,
            title: this.originBookable.title,
            available: false,
            externalSource: true,
            message: result.message,
            ...result,
          };
        }
      }
    }

    return runBookingDurationCheck({
      originBookable: this.originBookable,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
    });
  }

  async checkBlockPeriod() {
    return runBlockPeriodCheck({
      originBookable: this.originBookable,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
    });
  }

  async checkTimePeriod() {
    return runTimePeriodCheck({
      originBookable: this.originBookable,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
    });
  }

  async checkOpeningHours() {
    if (!(await this.isTimeRelated())) {
      return { checkType: CHECK_TYPES.OPENING_HOURS, available: true };
    }

    if (shouldSkipOpeningHoursCheck(this.originBookable)) {
      return { checkType: CHECK_TYPES.OPENING_HOURS, available: true };
    }

    const parentBookables = await BookableManager.getAncestorBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    for (const b of [this.originBookable, ...parentBookables]) {
      if (
        await OpeningHoursManager.hasOpeningHoursConflict(
          b,
          Number(this.timeBegin),
          Number(this.timeEnd),
        )
      ) {
        throw {
          checkType: CHECK_TYPES.OPENING_HOURS,
          available: false,
          message: `Die gewählte Buchungszeit liegt außerhalb der Öffnungszeiten von ${b.title}.`,
          bookings: [],
        };
      }
    }

    return { checkType: CHECK_TYPES.OPENING_HOURS, available: true };
  }

  async checkMaxBookingDate() {
    return runMaxBookingDateCheck(await this._availabilityParams());
  }

  async checkMinBookingLeadTime() {
    return runMinBookingLeadTimeCheck(await this._availabilityParams());
  }

  async checkEventDate() {
    const provider = await this._getAvailabilityProvider();
    return runEventDateCheck({
      provider,
      originBookable: this.originBookable,
    });
  }

  async checkMaxAmount() {
    if (this.hasExternalMaxAmount) {
      return await this._checkExternalMaxAmount();
    }
    return await this._checkInternalMaxAmount();
  }

  async _checkInternalMaxAmount() {
    // right now max amount is handles by availability check for bookables with amount.
    return {
      checkType: CHECK_TYPES.MAX_AMOUNT,
      available: true,
    };
  }

  async _checkExternalMaxAmount() {
    for (const provider of this.externalProviders) {
      if (!provider.handlesMaxAmount) continue;

      const result = await provider.checkMaxAmount(this.amount);

      if (!result.available) {
        throw {
          checkType: CHECK_TYPES.MAX_AMOUNT,
          available: false,
          message:
            result.message ||
            `Die gewünschte Stückzahl (${this.amount}) ist für ${this.originBookable.title} nicht zulässig.`,
          externalSource: true,
          ...result,
        };
      }
    }

    return {
      checkType: CHECK_TYPES.MAX_AMOUNT,
      available: true,
      externalSource: true,
    };
  }

  async checkAll(stopOnFirstError = true) {
    if (stopOnFirstError) {
      return await Promise.all([
        this.checkPermissions(),
        this.checkOpeningHours(),
        this.checkMaxAmount(),
        this.checkBlockPeriod(),
        this.checkTimePeriod(),
        this.checkBookingDuration(),
        this.checkAvailability(),
        this.checkEventDate(),
        this.checkEventSeats(),
        this.checkParentAvailability(),
        this.checkChildBookings(),
        this.checkMaxBookingDate(),
        this.checkMinBookingLeadTime(),
      ]);
    }

    return await Promise.allSettled([
      this.checkPermissions(),
      this.checkMaxAmount(),
      this.checkOpeningHours(),
      this.checkBlockPeriod(),
      this.checkTimePeriod(),
      this.checkBookingDuration(),
      this.checkAvailability(),
      this.checkEventDate(),
      this.checkEventSeats(),
      this.checkParentAvailability(),
      this.checkChildBookings(),
      this.checkMaxBookingDate(),
      this.checkMinBookingLeadTime(),
    ]);
  }

  _splitIntoDailySegments() {
    const segments = [];
    let cursor = new Date(this.timeBegin);

    while (cursor < this.timeEnd) {
      const nextMidnight = new Date(cursor);
      nextMidnight.setHours(24, 0, 0, 0);

      segments.push({
        start: new Date(cursor).getTime(),
        end:
          this.timeEnd < nextMidnight
            ? new Date(this.timeEnd).getTime()
            : nextMidnight.getTime(),
      });

      cursor = nextMidnight;
    }

    return segments.length > 0
      ? segments
      : [{ start: this.timeBegin, end: this.timeEnd }];
  }

  _weekdayNumber(date) {
    const d = date.getDay();
    return d === 0 ? 7 : d;
  }
}

class ManualItemCheckoutService extends ItemCheckoutService {
  constructor({
    user,
    tenantId,
    timeBegin,
    timeEnd,
    bookableId,
    amount,
    couponCode,
    bookWithoutDiscount,
  }) {
    super({
      user,
      tenantId,
      timeBegin,
      timeEnd,
      bookableId,
      amount,
      couponCode,
      bookWithoutDiscount,
    });
  }

  async init(originBookable) {
    if (originBookable) {
      this.originBookable =
        originBookable instanceof Bookable
          ? originBookable
          : new Bookable(originBookable);
    } else {
      this.originBookable = await super.getBookable();
    }
    this.externalProviders = await this._resolveExternalProviders();
  }
}

module.exports = {
  ItemCheckoutService,
  ManualItemCheckoutService,
  CheckoutPermissions,
  CHECK_TYPES,
};
