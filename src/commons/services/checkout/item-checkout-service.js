const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const EventManager = require("../../data-managers/event-manager");
const OpeningHoursManager = require("../../utilities/opening-hours-manager");
const TenantManger = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const CouponManager = require("../../data-managers/coupon-manager");
const { getTenant } = require("../../data-managers/tenant-manager");

const logger = bunyan.createLogger({
  name: "item-checkout-service.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutPermissions {
  static _isOwner(bookable, userId, tenantId) {
    return bookable.ownerUserId === userId && bookable.tenantId === tenantId;
  }

  static async _allowCheckout(bookable, userId, tenantId) {
    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await TenantManger.getTenantUsersByRoles(
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
   */
  constructor(
    user,
    tenantId,
    timeBegin,
    timeEnd,
    bookableId,
    amount,
    couponCode,
  ) {
    this.user = user;
    this.tenantId = tenantId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.bookableId = bookableId;
    this.amount = Number(amount);
    this.couponCode = couponCode;
    this.originBookable = null;
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

  get bookableUsed() {
    return this.originBookable;
  }

  get ignoreAmount() {
    return (
      (this.originBookable.priceType === "per-item" &&
        this.getPriceCategory()?.fixedPrice) ||
      (this.originBookable.priceType === "per-square-meter" &&
        this.getPriceCategory()?.fixedPrice)
    );
  }

  async calculateAmountBooked(bookable) {
    let concurrentBookings;

    if ((await this.isTimeRelated()) || (await this._isLongRange())) {
      if (!this.timeBegin || !this.timeEnd) {
        throw new Error(
          `Bookable with ID ${bookable.id} is time related but no time is given.`,
        );
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

    return concurrentBookings
      .map((cb) => cb.bookableItems)
      .flat()
      .filter((bi) => bi.bookableId === bookable.id)
      .reduce((acc, bi) => acc + bi.amount, 0);
  }

  async calculateAmountBookedTicketsByParent(parentBookable) {
    const childBookables = await BookableManager.getRelatedBookables(
      parentBookable.id,
      parentBookable.tenantId,
    );

    let amountBooked = 0;
    for (const childBookable of childBookables) {
      amountBooked += await this.calculateAmountBooked(childBookable);
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
  getBookingDuration() {
    if (!this.timeEnd || !this.timeBegin) {
      return 0;
    }
    return Math.round((this.timeEnd - this.timeBegin) / 60000);
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
    const priceCategory = this.getPriceCategory();

    let multiplier;
    if (!priceCategory?.fixedPrice) {
      switch (this.originBookable.priceType) {
        case "per-hour":
          multiplier = this.getBookingDuration() / 60;
          break;
        case "per-day":
          multiplier = this.getBookingDuration() / 1440;
          break;
        default:
          multiplier = 1;
      }
    } else {
      multiplier = 1;
    }

    const price = (Number(priceCategory?.priceEur) || 0) * multiplier;
    return Math.round(price * 100) / 100;
  }

  getPriceCategory() {
    const { priceCategories, priceType } = this.originBookable;

    if (priceCategories.length === 1) {
      return priceCategories[0];
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

    const category = priceCategories.find(({ interval }) => {
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
    const freeBookingUsers = [
      ...(this.originBookable.freeBookingUsers || []),
      ...(
        await TenantManger.getTenantUsersByRoles(
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
      logger.info(
        `User ${this.user} is allowed to book bookable ${this.bookableId} for free setting price to 0.`,
      );
      return 0;
    }

    const total = await CouponManager.applyCoupon(
      this.couponCode,
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
    if (this.originBookable.isBookable !== true) {
      throw new Error(
        `Bookable with ID ${this.originBookable.id} is not bookable.`,
      );
    }

    if (
      !(await CheckoutPermissions._allowCheckout(
        this.originBookable,
        this.user,
        this.tenantId,
      ))
    ) {
      throw new Error(
        `Sie sind nicht berechtigt, das Objekt ${this.originBookable.title} zu buchen.`,
      );
    }
  }

  /**
   * The method returns all concurrent bookings for the affected bookables.
   *
   * @returns {Promise<Boolean>}
   */
  async checkAvailability() {
    const amountBooked = await this.calculateAmountBooked(this.originBookable);

    const isAvailable =
      !this.originBookable.amount ||
      amountBooked + this.amount <= this.originBookable.amount;

    if (!isAvailable) {
      throw new Error(
        `Das Objekt ${this.originBookable.title} ist nur noch ${
          this.originBookable.amount - amountBooked
        } mal verfügbar.`,
      );
    }

    return true;
  }

  async checkParentAvailability() {
    const parentBookables = await BookableManager.getParentBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    for (const parentBookable of parentBookables) {
      const parentAmountBooked =
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

      if (!isAvailable) {
        throw new Error(
          `Übergeordnetes Objekt ${parentBookable.title} ist nicht verfügbar.`,
        );
      }
    }

    return true;
  }

  async checkChildBookings() {
    const childBookables = await BookableManager.getRelatedBookables(
      this.originBookable.id,
      this.originBookable.tenantId,
    );

    // remove self
    const filteredChildBookables = childBookables.filter(
      (cb) => cb.id !== this.originBookable.id,
    );

    for (const childBookable of filteredChildBookables) {
      const amountBooked = await this.calculateAmountBooked(childBookable);

      const isAvailable =
        !childBookable.amount ||
        amountBooked + this.amount <= childBookable.amount;

      if (!isAvailable) {
        throw new Error(
          `Abhängiges Objekt ${childBookable.title} ist für den gewählten Zeitraum bereits gebucht.`,
        );
      }
    }

    return true;
  }

  async checkEventSeats() {
    if (
      this.originBookable.type === "ticket" &&
      !!this.originBookable.eventId
    ) {
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
        !!event.attendees.maxAttendees &&
        amountBooked + this.amount > event.attendees.maxAttendees
      ) {
        throw new Error(
          `Die Veranstaltung ${event.information.name} hat nicht ausreichend freie Plätze.`,
        );
      }
    }

    return true;
  }

  async checkBookingDuration() {
    const hours = this.getBookingDuration() / 60;

    if (!this.originBookable.isScheduleRelated) {
      return true;
    }

    if (
      this.originBookable.minBookingDuration &&
      hours < this.originBookable.minBookingDuration
    ) {
      throw new Error(
        `Die Buchungsdauer für das Objekt muss mindestens ${this.originBookable.minBookingDuration} Stunden betragen.`,
      );
    }

    if (
      this.originBookable.maxBookingDuration &&
      hours > this.originBookable.maxBookingDuration
    ) {
      throw new Error(
        `Die Buchungsdauer für das Objekt darf ${this.originBookable.maxBookingDuration} Stunden nicht überschreiten.`,
      );
    }

    return true;
  }

  async checkOpeningHours() {
    if (!(await this.isTimeRelated())) {
      return true;
    }

    if (this.originBookable.isLongRange === true) {
      return true;
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
        throw new Error(
          `Die gewählte Buchungszeit liegt außerhalb der Öffnungszeiten von ${b.title}.`,
        );
      }
    }

    return true;
  }

  async checkMaxBookingDate() {
    const tenant = await getTenant(this.tenantId);

    const maxBookingAdvanceInMonths = Number(tenant?.maxBookingAdvanceInMonths);
    if (!maxBookingAdvanceInMonths) {
      return true;
    }

    const maxBookingDate = new Date();
    maxBookingDate.setMonth(
      maxBookingDate.getMonth() + maxBookingAdvanceInMonths,
    );

    if (this.timeBegin > maxBookingDate) {
      throw new Error(
        `Sie können maximal ${maxBookingAdvanceInMonths} Monate im Voraus buchen.`,
      );
    }

    return true;
  }

  async checkAll() {
    await this.checkPermissions();
    await this.checkOpeningHours();
    await this.checkBookingDuration();
    await this.checkAvailability();
    await this.checkEventSeats();
    await this.checkParentAvailability();
    await this.checkChildBookings();
    await this.checkMaxBookingDate();
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
};
