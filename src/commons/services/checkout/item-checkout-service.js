const BookableManager = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const EventManager = require("../../data-managers/event-manager");
const OpeningHoursManager = require("../../utilities/opening-hours-manager");
const UserManager = require("../../data-managers/user-manager");
const { RolePermission } = require("../../entities/role");
const bunyan = require("bunyan");
const CouponManager = require("../../data-managers/coupon-manager");
const { getTenant } = require("../../data-managers/tenant-manager");

const logger = bunyan.createLogger({
  name: "item-checkout-service.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutPermissions {
  static _isOwner(bookable, userId, tenant) {
    return bookable.ownerUserId === userId && bookable.tenant === tenant;
  }

  static async _allowCheckout(bookable, userId, tenant) {
    if (
      bookable.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readAny",
      ))
    )
      return true;

    if (
      bookable.tenant === tenant &&
      CheckoutPermissions._isOwner(bookable, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readOwn",
      ))
    )
      return true;

    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await UserManager.getUsersWithRoles(
          tenant,
          bookable.permittedRoles || [],
        )
      ).map((u) => u.id),
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
   * @param {User} user The user object
   * @param {string} tenantId The tenant ID
   * @param {Date} timeBegin The timestamp of the beginning of the booking
   * @param {Date} timeEnd The timestamp of the end of the booking
   * @param {Array} bookableId The ID of the bookable
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
    this.amount = amount;
    this.couponCode = couponCode;
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
        bookable.tenant,
        this.timeBegin,
        this.timeEnd,
      );
    } else {
      concurrentBookings = await BookingManager.getRelatedBookings(
        bookable.id,
        bookable.tenant,
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
      parentBookable.tenant,
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
    return Math.round((this.timeEnd - this.timeBegin) / 60000);
  }

  async isTimeRelated() {
    const bookable = await this.getBookable();
    return (
      bookable.isScheduleRelated === true ||
      bookable.isTimePeriodRelated === true ||
      bookable.isLongRange === true
    );
  }

  async _isLongRange() {
    const bookable = await this.getBookable();
    return bookable.isLongRange === true;
  }

  async regularPriceEur() {
    const bookable = await this.getBookable();

    let multiplier;
    switch (bookable.priceCategory) {
      case "per-item":
        multiplier = 1;
        break;
      case "per-hour":
        multiplier = this.getBookingDuration() / 60;
        break;
      case "per-day":
        multiplier = this.getBookingDuration() / 1440;
        break;
      default:
        multiplier = 1;
    }

    return (bookable.priceEur || 0) * multiplier * this.amount;
  }

  async userPriceEur() {
    const bookable = await this.getBookable();

    const freeBookingUsers = [
      ...(bookable.freeBookingUsers || []),
      ...(
        await UserManager.getUsersWithRoles(
          this.tenantId,
          bookable.freeBookingRoles || [],
        )
      ).map((u) => u.id),
    ];

    if (
      !!this.user &&
      freeBookingUsers.includes(this.user?.id) &&
      bookable.tenant === this.user?.tenant
    ) {
      logger.info(
        `User ${this.user?.id} is allowed to book bookable ${this.bookableId} for free setting price to 0.`,
      );
      return 0;
    }

    const total = await CouponManager.applyCoupon(
      this.couponCode,
      this.tenantId,
      await this.regularPriceEur(),
    );

    return total;
  }

  async checkPermissions() {
    const bookable = await this.getBookable();
    if (bookable.isBookable !== true) {
      throw new Error(`Bookable with ID ${bookable.id} is not bookable.`);
    }

    if (
      !(await CheckoutPermissions._allowCheckout(
        bookable,
        this.user?.id,
        this.tenantId,
      ))
    ) {
      throw new Error(
        `Sie sind nicht berechtigt, das Objekt ${bookable.title} zu buchen.`,
      );
    }
  }

  /**
   * The method returns all concurrent bookings for the affected bookables.
   *
   * @returns {Promise<Booking[]>} An array of concurrent bookings
   */
  async checkAvailability() {
    const bookable = await this.getBookable();
    const amountBooked = await this.calculateAmountBooked(bookable);

    const isAvailable =
      !bookable.amount || amountBooked + this.amount <= bookable.amount;

    if (!isAvailable) {
      throw new Error(
        `Das Objekt ${bookable.title} ist nur noch ${
          bookable.amount - amountBooked
        } mal verfügbar.`,
      );
    }

    return true;
  }

  async checkParentAvailability() {
    const bookable = await this.getBookable();
    const parentBookables = await BookableManager.getParentBookables(
      bookable.id,
      bookable.tenant,
    );

    for (const parentBookable of parentBookables) {
      const parentAmountBooked = await this.calculateAmountBooked(
        parentBookable,
      );

      let isAvailable;
      if (bookable.type === "ticket") {
        const amountBooked = await this.calculateAmountBookedTicketsByParent(
          parentBookable,
        );
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
    const bookable = await this.getBookable();
    const childBookables = await BookableManager.getRelatedBookables(
      bookable.id,
      bookable.tenant,
    );

    for (const childBookable of childBookables) {
      const amountBooked = await this.calculateAmountBooked(childBookable);

      if (amountBooked > 0) {
        throw new Error(
          `Abhängiges Objekt ${childBookable.title} ist für den gewählten Zeitraum bereits gebucht.`,
        );
      }
    }

    return true;
  }

  async checkEventSeats() {
    const bookable = await this.getBookable();
    if (bookable.type === "ticket" && !!bookable.eventId) {
      const event = await EventManager.getEvent(
        bookable.eventId,
        bookable.tenant,
      );

      const eventBookings = await BookingManager.getEventBookings(
        bookable.tenant,
        bookable.eventId,
      );

      const amountBooked = eventBookings
        .map((cb) => cb.bookableItems)
        .flat()
        .filter(
          (bi) =>
            bi.bookableId === bookable.id && bi.tenant === bookable.tenant,
        )
        .reduce((acc, bi) => acc + bi.amount, 0);

      if (
        !!event.attendees.maxAttendees &&
        amountBooked + this.amount >= event.attendees.maxAttendees
      ) {
        throw new Error(
          `Die Veranstaltung ${event.information.name} hat nicht ausreichend freie Plätze.`,
        );
      }
    }

    return true;
  }

  async checkBookingDuration() {
    const bookable = await this.getBookable();
    const hours = this.getBookingDuration() / 60;

    if (bookable.minBookingDuration && hours < bookable.minBookingDuration) {
      throw new Error(
        `Die Buchungsdauer für das Objekt muss mindestens ${bookable.minBookingDuration} Stunden betragen.`,
      );
    }

    if (bookable.maxBookingDuration && hours > bookable.maxBookingDuration) {
      throw new Error(
        `Die Buchungsdauer für das Objekt darf ${bookable.maxBookingDuration} Stunden nicht überschreiten.`,
      );
    }

    return true;
  }

  async checkOpeningHours() {
    if (!(await this.isTimeRelated())) {
      return true;
    }

    const bookable = await this.getBookable();

    if (bookable.isLongRange === true) {
      return true;
    }

    const parentBookables = await BookableManager.getParentBookables(
      bookable.id,
      bookable.tenant,
    );

    for (const b of [bookable, ...parentBookables]) {
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

    const maxBookingMonths = Number(tenant?.maxBookingMonths);
    if (!maxBookingMonths) {
      return true;
    }

    const maxBookingDate = new Date();
    maxBookingDate.setMonth(maxBookingDate.getMonth() + maxBookingMonths);

    if (this.timeBegin > maxBookingDate) {
      throw new Error(
        `Sie können maximal ${maxBookingMonths} Monate im Voraus buchen.`,
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

module.exports = ItemCheckoutService;
