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
        this.getPriceCategory({})?.fixedPrice) ||
      (this.originBookable.priceType === "per-square-meter" &&
        this.getPriceCategory({})?.fixedPrice)
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

    let useSubset = false;

    if (this.originBookable.priceType === "per-hour") {
      /*
       * For per-hour pricing we always check how many hours are booked in the given segment.
       * This is important for bookings that span multiple days.
       * For example, a booking from 2023-10-01 18:00 to 2023-10-02 06:00 should be charged
       * for 6 hours on 2023-10-01 and 6 hours on 2023-10-02.
       *
       * Therefore, a price category for a bookable with the priceType "per-hour" can only be valid until 24 hours.
       * So if we have a price category that is valid from 0 to 12 hours (10€ per hour) and another one from 12 to 24 hours (80€ flat) and we have a booking of 28 hours,
       * from 2023-10-01 08:00 to 2023-10-02 12:00, we need to check the price category for the first segment from 08:00 to 24:00 (16 hours)
       * and for the second segment from 00:00 to 12:00 (12 hours).
       * In this case, the first segment would be charged with 80€ (flat rate for 12-24 hours) and the second segment with 120€ (12 hours * 10€ per hour).
       * The total price would be 200€.
       *
       */
      useSubset = true;
    }

    const prices = [];

    let { priceCategories, priceType } = JSON.parse(
      JSON.stringify(this.originBookable),
    );

    let totalPrice = 0;

    if (priceType === "per-day") {
      totalPrice =
        this.getPriceForDayType(segments, priceCategories) * this.amount;
    } else {
      for (const segment of segments) {
        const priceCategory = this.getPriceCategory({
          segmentStart: segment.start,
          segmentEnd: segment.end,
          useSubset,
        });

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

        prices.push({
          price: (Number(priceCategory.priceEur) || 0) * multiplier,
          fixedPrice: priceCategory.fixedPrice,
        });
      }

      if (
        this.originBookable.priceType === "per-square-meter" ||
        this.originBookable.priceType === "per-item"
      ) {
        //TODO: wenn meherere Tage gebucht werden, muss der Preis pro Tag ermittel werden und ein gesamtpreis muss ausgegeben werden
        /*
         * Wenn zum beispiel die buchung an zwei tagen ist und an einem der tage pauschal verrechnet wird,
         * muss für den Tag der pauschalpreis angenommen werden und für den anderen tag der reguläre preis.
         * Es ist aber auch zu bedenken, dass wenn der Preis an beiden Tagen pauschal ist, dass dann nur einmal der höchste Preis genommen wird.
         */
        const fixedPriceCategories = prices.filter((pc) => pc.fixedPrice);
        if (fixedPriceCategories.length > 0) {
          totalPrice = Math.max(...fixedPriceCategories.map((p) => p.price));
        } else {
          totalPrice =
            prices.reduce((acc, price) => acc + price.price, 0) * this.amount;
        }
      } else {
        totalPrice =
          prices.reduce((acc, price) => acc + price.price, 0) * this.amount;
      }
    }

    return { price: Math.round(totalPrice * 100) / 100 };
  }

  getPriceCategory({
    segmentStart = null,
    segmentEnd = null,
    useSubset = false,
  }) {
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

    let bookingDurationInMinutes;

    if (useSubset) {
      bookingDurationInMinutes = this.getBookingDuration(start, end);
    } else {
      bookingDurationInMinutes = this.getBookingDuration();
    }

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
        (start === "" || start === null || start <= valueToCheck) &&
        (end === "" || end === null || end >= valueToCheck)
      );
    });

    return category ?? null;
  }

  async regularGrossPriceEur() {
    const { price } = await this.regularPriceEur();

    const finalPrice = price * (1 + (await this.priceValueAddedTax()));

    return { price: Math.round(finalPrice * 100) / 100 };
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

    const { price: regularPrice } = await this.regularPriceEur();

    const total = await CouponManager.applyCoupon(
      this.originBookable.enableCoupons ? this.couponCode : null,
      this.tenantId,
      regularPrice,
    );

    return { price: Math.round(total * 100) / 100 };
  }

  async userGrossPriceEur() {
    const { price } = await this.userPriceEur();

    const total = price * (1 + (await this.priceValueAddedTax()));

    return { price: Math.round(total * 100) / 100 };
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
    const end = new Date(this.timeEnd);

    while (cursor < end) {
      const nextMidnight = new Date(cursor);
      nextMidnight.setHours(0, 0, 0, 0);
      nextMidnight.setDate(nextMidnight.getDate() + 1);

      const segmentEnd = end < nextMidnight ? end : nextMidnight;

      /**
       * Add new segment
       * -1ms, to avoid overlapping segments
       */
      segments.push({
        start: cursor.getTime(),
        end: segmentEnd.getTime() - 1,
      });

      cursor = new Date(nextMidnight);
    }

    return segments.length > 0
      ? segments
      : [{ start: this.timeBegin, end: this.timeEnd }];
  }

  _weekdayNumber(date) {
    const d = date.getDay();
    return d === 0 ? 7 : d;
  }

  getPriceForDayType(segments, priceCategories) {
    for (const [i, segment] of segments.entries()) {
      const dayBegin = new Date(segment.start).getDay();
      const dayEnd = new Date(segment.end).getDay();

      const bookingYear = new Date(segment.start).getFullYear();
      const bookingDate = formatISO(new Date(segment.start)).split("T")[0];

      const holidaysPriceCategories = priceCategories.filter(
        (pc) => pc.holidays.length > 0,
      );

      const filteredHolidayPriceCategories = [];
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
            filteredHolidayPriceCategories.push(pc);
          }
        }
      }

      if (filteredHolidayPriceCategories.length >= 1) {
        for (const pc of filteredHolidayPriceCategories) {
          if (pc.matchCount) {
            pc.matchCount.push(i);
          } else {
            pc.matchCount = [i];
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

      for (const pc of filteredWeekdaysPriceCategories) {
        if (pc.weekdays.includes(dayBegin) || pc.weekdays.includes(dayEnd)) {
          if (pc.matchCount) {
            pc.matchCount.push(i);
          } else {
            pc.matchCount = [i];
          }
        }
      }

      for (const pc of priceCategories) {
        if (pc.weekdays.length === 0 && pc.holidays.length === 0) {
          if (pc.matchCount) {
            pc.matchCount.push(i);
          } else {
            pc.matchCount = [i];
          }
        }
      }
    }

    const holidaysPriceCategories = priceCategories.filter(
      (pc) => pc.holidays.length > 0,
    );

    const weekdayPriceCategories = priceCategories.filter(
      (pc) => pc.weekdays.length > 0,
    );

    const generalPriceCategories = priceCategories.filter(
      (pc) => pc.weekdays.length === 0 && pc.holidays.length === 0,
    );

    for (const pc of holidaysPriceCategories) {
      if (fulfilledDay(pc)) {
        for (const otherPc of priceCategories) {
          if (otherPc !== pc) {
            otherPc.matchCount =
              otherPc.matchCount?.filter((i) => !pc.matchCount.includes(i)) ||
              [];
          }
        }
      }
    }

    for (const pc of weekdayPriceCategories) {
      if (fulfilledDay(pc)) {
        for (const otherPc of priceCategories) {
          if (otherPc !== pc) {
            otherPc.matchCount =
              otherPc.matchCount?.filter((i) => !pc.matchCount.includes(i)) ||
              [];
          }
        }
      }
    }

    for (const pc of generalPriceCategories) {
      if (fulfilledDay(pc)) {
        for (const otherPc of priceCategories) {
          if (otherPc !== pc) {
            otherPc.matchCount =
              otherPc.matchCount?.filter((i) => !pc.matchCount.includes(i)) ||
              [];
          }
        }
      }
    }

    let totalPrice = null;

    for (const pc of priceCategories) {
      if (pc.matchCount.length > 0) {
        if (pc.fixedPrice) {
          totalPrice = (totalPrice || 0) + pc.priceEur;
        } else {
          for (const index of pc.matchCount) {
            const segment = segments[index];
            const bookingDurationInMinutes = this.getBookingDuration(
              segment.start,
              segment.end,
            );

            const multiplier = bookingDurationInMinutes / 60 / 24;
            totalPrice = (totalPrice || 0) + pc.priceEur * multiplier;
          }
        }
      }
    }

    if (totalPrice === null) {
      throw {
        checkType: CHECK_TYPES.PRICE_CATEGORY,
        available: false,
        message: `Es konnte keine passende Preiskategorie für das Objekt ${this.originBookable.title} gefunden werden.`,
      };
    }

    return totalPrice;
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

function fulfilledDay(pc) {
  if (!pc.matchCount || pc.matchCount.length === 0) {
    return false;
  }
  const rawStart = pc?.interval?.start;
  const rawEnd = pc?.interval?.end;

  const start =
    rawStart === "" || rawStart === undefined || rawStart === null
      ? -Infinity
      : Number(rawStart);
  const end =
    rawEnd === "" || rawEnd === undefined || rawEnd === null
      ? Infinity
      : Number(rawEnd);

  const normStart = Number.isNaN(start) ? -Infinity : start;
  const normEnd = Number.isNaN(end) ? Infinity : end;

  const count = pc.matchCount?.length || 0;

  return count > normStart && count <= normEnd;
}

module.exports = {
  ItemCheckoutService,
  ManualItemCheckoutService,
  CheckoutPermissions,
  CHECK_TYPES,
};
