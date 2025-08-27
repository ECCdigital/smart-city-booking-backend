const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const EventManager = require("../../data-managers/event-manager");
const OpeningHoursManager = require("../../utilities/opening-hours-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const CouponManager = require("../../data-managers/coupon-manager");
const { getTenant } = require("../../data-managers/tenant-manager");
const HolidaysService = require("../holiday/holidays-service");
const { formatISO } = require("date-fns");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");

const logger = bunyan.createLogger({
  name: "item-checkout-service.js",
  level: process.env.LOG_LEVEL,
});

const CHECK_TYPES = {
  PERMISSION: "permission",
  AVAILABILITY: "availability",
  PARENT_AVAILABILITY: "parent-availability",
  OPENING_HOURS: "opening-hours",
  BOOKING_DURATION: "booking-duration",
  EVENT_DATE: "event-date",
  EVENT_SEATS: "event-seats",
  CHILD_BOOKINGS: "child-bookings",
  MAX_BOOKING_DATE: "max-booking-date",
  TIME_RELATION: "time-relation",
  PRICE_CATEGORY: "price-category",
};

class CheckoutPermissions {
  static _isOwner(bookable, userId, tenantId) {
    return bookable.ownerUserId === userId && bookable.tenantId === tenantId;
  }

  static async _allowCheckout(bookable, userId, tenantId) {
    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await TenantManager.getTenantUsersByRoles(
          tenantId,
          bookable.permittedRoles || [],
        )
      ).map((u) => u.userId),
    ];

    if (permittedUsers.length > 0 && !permittedUsers.includes(userId)) {
      return false;
    }

    return true;
  }
}

class ItemCheckoutService {
  /**
   * Creates an instance of CheckoutManager.
   *
   * @param {Object} user The user object
   * @param {string} tenantId The tenant ID
   * @param {string} timeBegin The timestamp of the beginning of the booking
   * @param {string} timeEnd The timestamp of the end of the booking
   * @param {string} bookableId The ID of the bookable
   * @param {number} amount The amount of the booking
   * @param {string} couponCode The coupon code
   * @param {boolean} bookWithPrice Determines whether the booking process should include pricing calculations. 
   *                                Set to `true` to enable pricing considerations, or `false` to skip them. Defaults to `true`.
   */
  constructor(
    user,
    tenantId,
    timeBegin,
    timeEnd,
    bookableId,
    amount,
    couponCode,
    bookWithPrice,
  ) {
    this.user = user;
    this.tenantId = tenantId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.bookableId = bookableId;
    this.amount = Number(amount);
    this.couponCode = couponCode;
    this.originBookable = null;
    this.bookWithPrice = bookWithPrice ?? true;
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
    this.bookWithPrice = null;
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

  async freeBookingAllowed() {
    const freeBookingUsers = [
      ...(this.originBookable.freeBookingUsers || []),
      ...(
        await TenantManager.getTenantUsersByRoles(
          this.tenantId,
          this.originBookable.freeBookingRoles || [],
        )
      ).map((u) => u.userId),
    ];

    if (
      !!this.user &&
      freeBookingUsers.includes(this.user) &&
      this.originBookable.tenantId === this.tenantId
    ) {
      return true;
    } else {
      return false;
    }
  }

  async calculateAmountBooked(bookable) {
    let concurrentBookings;

    if ((await this.isTimeRelated()) || (await this._isLongRange())) {
      if (!this.timeBegin || !this.timeEnd) {
        logger.warn(
          `Bookable with ID ${bookable.id} is time related but no time is given.`,
        );
        throw {
          checkType: CHECK_TYPES.TIME_RELATION,
          available: false,
          message: `Das Objekt ${bookable.title} ist zeitbezogen, aber es wurde kein Zeitraum angegeben.`,
        };
      }

      concurrentBookings = await BookingManager.getConcurrentBookings(
        bookable.id,
        bookable.tenantId,
        this.timeBegin,
        this.timeEnd,
      );
    } else {
      concurrentBookings = await BookingManager.getRelatedBookings(
        bookable.tenantId,
        bookable.id,
      );
    }

    const amountBooked = concurrentBookings
      .map((cb) => cb.bookableItems)
      .flat()
      .filter((bi) => bi.bookableId === bookable.id)
      .reduce((acc, bi) => acc + bi.amount, 0);
    return {
      amountBooked,
      bookings: concurrentBookings.map((cb) => ({
        id: cb.id,
        timeBegin: cb.timeBegin,
        timeEnd: cb.timeEnd,
      })),
    };
  }

  async calculateAmountBookedTicketsByParent(parentBookable) {
    const childBookables = await BookableManager.getRelatedBookables(
      parentBookable.id,
      parentBookable.tenantId,
    );

    let amountBooked = 0;
    for (const childBookable of childBookables) {
      amountBooked += (await this.calculateAmountBooked(childBookable))
        .amountBooked;
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
    return (
      this.originBookable.isScheduleRelated === true ||
      this.originBookable.isTimePeriodRelated === true ||
      this.originBookable.isLongRange === true
    );
  }

  async _isLongRange() {
    return this.originBookable.isLongRange === true;
  }

  async priceValueAddedTax() {
    return (this.originBookable.priceValueAddedTax || 0) / 100;
  }

  async regularPriceEur() {
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
        (start === null || start <= valueToCheck) &&
        (end === null || end >= valueToCheck)
      );
    });

    return category ?? null;
  }

  async regularGrossPriceEur() {
    const price =
      (await this.regularPriceEur()) * (1 + (await this.priceValueAddedTax()));
    return Math.round(price * 100) / 100;
  }

  async userPriceEur() {
    if (await this.freeBookingAllowed()) {
      if (!this.bookWithPrice) {
        logger.info(
          `User ${this.user} is allowed to book bookable ${this.bookableId} for free, but bookWithPrice is set to false.`,
        );
        return 0;
      }
    }

    const total = await CouponManager.applyCoupon(
      this.originBookable.enableCoupons ? this.couponCode : null,
      this.tenantId,
      await this.regularPriceEur(),
    );

    return Math.round(total * 100) / 100;
  }

  async userGrossPriceEur() {
    const price =
      (await this.userPriceEur()) * (1 + (await this.priceValueAddedTax()));
    return Math.round(price * 100) / 100;
  }

  async checkPermissions() {
    if (this.originBookable?.isBookable !== true) {
      throw {
        checkType: CHECK_TYPES.PERMISSION,
        available: false,
        message: `Das Objekt ${this.originBookable.title}, mit der ID ${this.originBookable.id} ist nicht buchbar.`,
      };
    }

    if (
      !(await CheckoutPermissions._allowCheckout(
        this.originBookable,
        this.user,
        this.tenantId,
      ))
    ) {
      throw {
        checkType: CHECK_TYPES.PERMISSION,
        available: false,
        message: `Sie haben keine Berechtigung, das Objekt ${this.originBookable.title} zu buchen.`,
      };
    }

    return { checkType: CHECK_TYPES.PERMISSION, available: true };
  }

  /**
   * The method returns all concurrent bookings for the affected bookables.
   *
   * @returns {Promise<Object>}
   */
  async checkAvailability() {
    const { amountBooked, bookings } = await this.calculateAmountBooked(
      this.originBookable,
    );

    const isAvailable =
      !this.originBookable.amount ||
      amountBooked + this.amount <= this.originBookable.amount;

    if (!isAvailable) {
      throw {
        checkType: CHECK_TYPES.AVAILABILITY,
        available: false,
        message: `Das Objekt ${this.originBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
        totalCapacity: this.originBookable.amount,
        booked: amountBooked,
        remaining:
          this.originBookable.amount > 0
            ? this.originBookable.amount - amountBooked
            : null,
        concurrentBookings: bookings,
      };
    }

    return {
      checkType: CHECK_TYPES.AVAILABILITY,
      available: true,
      totalCapacity: this.originBookable.amount,
      booked: amountBooked,
      remaining:
        this.originBookable.amount > 0
          ? this.originBookable.amount - amountBooked
          : null,
    };
  }

  async checkParentAvailability() {
    const parentBookables = await BookableManager.getParentBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    const parentAmount = [];

    for (const parentBookable of parentBookables) {
      const { amountBooked: parentAmountBooked, bookings } =
        await this.calculateAmountBooked(parentBookable);

      let isAvailable;
      if (this.originBookable.type === "ticket") {
        const amountBooked =
          await this.calculateAmountBookedTicketsByParent(parentBookable);
        isAvailable =
          !parentBookable.amount ||
          parentAmountBooked + amountBooked + this.amount <=
            parentBookable.amount;
      } else {
        isAvailable =
          !parentBookable.amount || parentAmountBooked < parentBookable.amount;
      }

      parentAmount.push({
        bookableId: parentBookable.id,
        title: parentBookable.title,
        totalCapacity: parentBookable.amount,
        booked: parentAmountBooked,
        remaining: parentBookable.amount - parentAmountBooked,
        isAvailable: isAvailable,
      });

      if (!isAvailable) {
        throw {
          checkType: CHECK_TYPES.PARENT_AVAILABILITY,
          available: false,
          message: `Übergeordnetes Objekt ${parentBookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
          parentAvailability: parentAmount,
          concurrentBookings: bookings,
        };
      }
    }

    return {
      checkType: CHECK_TYPES.PARENT_AVAILABILITY,
      available: true,
      parentAvailabilities: parentAmount,
    };
  }

  async checkChildBookings() {
    const childBookables = await BookableManager.getRelatedBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    const childAmount = [];

    // remove self
    const filteredChildBookables = childBookables.filter(
      (cb) => cb.id !== this.originBookable.id,
    );

    for (const childBookable of filteredChildBookables) {
      const { amountBooked, bookings } =
        await this.calculateAmountBooked(childBookable);

      const isAvailable =
        !childBookable.amount ||
        amountBooked + this.amount <= childBookable.amount;

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
          concurrentBookings: bookings,
        };
      }
    }

    return {
      checkType: CHECK_TYPES.CHILD_BOOKINGS,
      available: true,
      childAvailabilities: childAmount,
    };
  }

  async checkEventSeats() {
    if (this.hasEvent) {
      const event = await EventManager.getEvent(
        this.originBookable.eventId,
        this.originBookable.tenantId,
      );

      const eventBookings = await BookingManager.getEventBookings(
        this.originBookable.tenantId,
        this.originBookable.eventId,
      );

      const amountBooked = eventBookings
        .map((cb) => cb.bookableItems)
        .flat()
        .filter(
          (bi) =>
            bi._bookableUsed.eventId === this.originBookable.eventId &&
            bi._bookableUsed.tenantId === this.originBookable.tenantId,
        )
        .reduce((acc, bi) => acc + bi.amount, 0);

      if (
        !!event?.attendees.maxAttendees &&
        amountBooked + this.amount > event.attendees.maxAttendees
      ) {
        throw {
          checkType: CHECK_TYPES.EVENT_SEATS,
          available: false,
          message: `Die Veranstaltung ${event.information.name} hat nicht ausreichend freie Plätze.`,
          totalCapacity: event.attendees.maxAttendees,
          booked: amountBooked,
          remaining: event.attendees.maxAttendees - amountBooked,
        };
      }
      return {
        checkType: CHECK_TYPES.EVENT_SEATS,
        available: true,
        totalCapacity: event?.attendees.maxAttendees,
        booked: amountBooked,
        remaining: event?.attendees.maxAttendees - amountBooked,
      };
    }

    return {
      checkType: CHECK_TYPES.EVENT_SEATS,
      available: true,
    };
  }

  async checkBookingDuration() {
    const hours = this.getBookingDuration() / 60;

    if (!this.originBookable.isScheduleRelated) {
      return { checkType: CHECK_TYPES.BOOKING_DURATION, available: true };
    }

    if (
      this.originBookable.minBookingDuration &&
      hours < this.originBookable.minBookingDuration
    ) {
      throw {
        checkType: CHECK_TYPES.BOOKING_DURATION,
        available: false,
        message: `Die Buchungsdauer für das Objekt ${this.originBookable.title} muss mindestens ${this.originBookable.minBookingDuration} Stunden betragen.`,
      };
    }

    if (
      this.originBookable.maxBookingDuration &&
      hours > this.originBookable.maxBookingDuration
    ) {
      throw {
        checkType: CHECK_TYPES.BOOKING_DURATION,
        available: false,
        message: `Die Buchungsdauer für das Objekt ${this.originBookable.title} darf ${this.originBookable.maxBookingDuration} Stunden nicht überschreiten.`,
      };
    }

    return {
      checkType: CHECK_TYPES.BOOKING_DURATION,
      available: true,
    };
  }

  async checkOpeningHours() {
    if (!(await this.isTimeRelated())) {
      return { checkType: CHECK_TYPES.OPENING_HOURS, available: true };
    }

    if (this.originBookable.isLongRange === true) {
      return { checkType: CHECK_TYPES.OPENING_HOURS, available: true };
    }

    const parentBookables = await BookableManager.getParentBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    for (const b of [this.originBookable, ...parentBookables]) {
      if (
        await OpeningHoursManager.hasOpeningHoursConflict(
          b,
          this.timeBegin,
          this.timeEnd,
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
    const tenant = await getTenant(this.tenantId);

    const maxBookingAdvanceInMonths = Number(tenant?.maxBookingAdvanceInMonths);
    if (!maxBookingAdvanceInMonths) {
      return { checkType: CHECK_TYPES.MAX_BOOKING_DATE, available: true };
    }

    const maxBookingDate = new Date();
    maxBookingDate.setMonth(
      maxBookingDate.getMonth() + maxBookingAdvanceInMonths,
    );

    if (this.timeBegin > maxBookingDate) {
      throw {
        checkType: CHECK_TYPES.MAX_BOOKING_DATE,
        available: false,
        message: `Die Buchung für das Objekt ${this.originBookable.title} ist nur bis zu ${maxBookingAdvanceInMonths} Monate im Voraus möglich.`,
      };
    }

    return { checkType: CHECK_TYPES.MAX_BOOKING_DATE, available: true };
  }

  async checkEventDate() {
    if (
      this.originBookable.type === BOOKABLE_TYPES.TICKET &&
      !!this.originBookable.eventId
    ) {
      const event = await EventManager.getEvent(
        this.originBookable.eventId,
        this.originBookable.tenantId,
      );

      if (!event) {
        throw {
          checkType: CHECK_TYPES.EVENT_DATE,
          available: false,
          message: `Die Veranstaltung für das Ticket ${this.originBookable.title} existiert nicht.`,
        };
      }

      const now = new Date();
      const eventEndDate = event.information.endDate
        ? new Date(event.information.endDate)
        : null;

      const eventDate =
        eventEndDate ||
        (event.information.startDate
          ? new Date(event.information.startDate)
          : null);

      if (!eventDate) {
        return {
          checkType: CHECK_TYPES.EVENT_DATE,
          available: true,
        };
      }

      if (eventEndDate && event.information.endTime) {
        const [hours, minutes] = event.information.endTime
          .split(":")
          .map(Number);
        eventEndDate.setHours(hours, minutes, 0, 0);
      } else if (!eventEndDate && event.information.startTime) {
        const [hours, minutes] = event.information.startTime
          .split(":")
          .map(Number);
        eventDate.setHours(hours, minutes, 0, 0);
      }

      if (eventDate < now) {
        throw {
          checkType: CHECK_TYPES.EVENT_DATE,
          available: false,
          message: `Die Veranstaltung ${event.information.name} liegt in der Vergangenheit und kann nicht mehr gebucht werden.`,
        };
      }
    }

    return {
      checkType: CHECK_TYPES.EVENT_DATE,
      available: true,
    };
  }

  async checkAll(stopOnFirstError = true) {
    if (stopOnFirstError) {
      return await Promise.all([
        this.checkPermissions(),
        this.checkOpeningHours(),
        this.checkBookingDuration(),
        this.checkAvailability(),
        this.checkEventDate(),
        this.checkEventSeats(),
        this.checkParentAvailability(),
        this.checkChildBookings(),
        this.checkMaxBookingDate(),
      ]);
    }

    return await Promise.allSettled([
      this.checkPermissions(),
      this.checkOpeningHours(),
      this.checkBookingDuration(),
      this.checkAvailability(),
      this.checkEventDate(),
      this.checkEventSeats(),
      this.checkParentAvailability(),
      this.checkChildBookings(),
      this.checkMaxBookingDate(),
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
  constructor(
    user,
    tenantId,
    timeBegin,
    timeEnd,
    bookableId,
    amount,
    couponCode,
  ) {
    super(user, tenantId, timeBegin, timeEnd, bookableId, amount, couponCode);
  }

  async init(originBookable) {
    this.originBookable =
      JSON.parse(JSON.stringify(originBookable)) ?? (await super.getBookable());
  }
}

module.exports = {
  ItemCheckoutService,
  ManualItemCheckoutService,
  CheckoutPermissions,
  CHECK_TYPES,
};
