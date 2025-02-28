const {
  ItemCheckoutService,
  ManualItemCheckoutService,
} = require("./item-checkout-service");
const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const CouponManager = require("../../data-managers/coupon-manager");
const LockerService = require("../locker/locker-service");

/**
 * Class representing a bundle checkout service.
 */
class BundleCheckoutService {
  /**
   * Create a bundle checkout service.
   * @param {Object} user - The user Object.
   * @param {string} tenant - The tenant ID.
   * @param {Date} timeBegin - The start time.
   * @param {Date} timeEnd - The end time,
   * @param {Date} timeCreated - The creation time.
   * @param {Array} bookableItems - The items to be booked.
   * @param {string} couponCode - The coupon code.
   * @param {string} name - The name of the user.
   * @param {string} company - The company of the user.
   * @param {string} street - The street of the user.
   * @param {string} zipCode - The zip code of the user.
   * @param {string} location - The location of the user.
   * @param {string} email - The email of the user.
   * @param {string} phone - The phone number of the user.
   * @param {string} comment - The comment of the user.
   * @param {Array} attachmentStatus - The attachments of the user.
   * @param {string} paymentProvider - The payment method.
   */
  constructor(
    user,
    tenant,
    timeBegin,
    timeEnd,
    timeCreated,
    bookableItems,
    couponCode,
    name,
    company,
    street,
    zipCode,
    location,
    email,
    phone,
    comment,
    attachmentStatus,
    paymentProvider,
  ) {
    this.user = user;
    this.tenant = tenant;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.timeCreated = timeCreated || Date.now();
    this.bookableItems = bookableItems;
    this.couponCode = couponCode;
    this.name = name;
    this.company = company;
    this.street = street;
    this.zipCode = zipCode;
    this.location = location;
    this.email = email;
    this.phone = phone;
    this.comment = comment;
    this.attachmentStatus = attachmentStatus;
    this.paymentProvider = paymentProvider;
  }

  async createItemCheckoutService(bookableItem) {
    const itemCheckoutService = new ItemCheckoutService(
      this.user,
      this.tenant,
      this.timeBegin,
      this.timeEnd,
      bookableItem.bookableId,
      bookableItem.amount,
      this.couponCode,
    );
    await itemCheckoutService.init();

    return itemCheckoutService;
  }

  async generateBookingReference(
    length = 8,
    chunkLength = 4,
    possible = "ABCDEFGHJKMNPQRSTUXY",
    ensureUnique = true,
    retryCount = 10,
  ) {
    if (ensureUnique && retryCount <= 0) {
      throw new Error(
        "Unable to generate booking number. Retry count exceeded.",
      );
    }

    let text = "";
    for (let i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    for (let i = chunkLength; i < text.length; i += chunkLength + 1) {
      text = text.slice(0, i) + "-" + text.slice(i);
    }

    if (ensureUnique) {
      if (!!(await BookingManager.getBooking(text, this.tenant).id)) {
        return await this.generateBookingReference(
          length,
          chunkLength,
          possible,
          ensureUnique,
          retryCount - 1,
        );
      }
    }

    return text;
  }
  async checkAll() {
    for (const bookableItem of this.bookableItems) {
      const itemCheckoutService =
        await this.createItemCheckoutService(bookableItem);

      await itemCheckoutService.checkAll();
    }

    return true;
  }

  async userPriceEur() {
    let total = 0;
    for (const bookableItem of this.bookableItems) {
      total += bookableItem.userPriceEur * bookableItem.amount;
    }

    return Math.round(total * 100) / 100;
  }

  async userGrossPriceEur() {
    let total = 0;
    for (const bookableItem of this.bookableItems) {
      total += bookableItem.userGrossPriceEur * bookableItem.amount;
    }
    return Math.round(total * 100) / 100;
  }

  async vatIncludedEur() {
    const vat = (await this.userGrossPriceEur()) - (await this.userPriceEur());
    return Math.round(vat * 100) / 100;
  }

  async isPaymentComplete() {
    return (await this.userPriceEur()) === 0;
  }

  async isAutoCommit() {
    for (const bookableItem of this.bookableItems) {
      const bookable = await BookableManager.getBookable(
        bookableItem.bookableId,
        this.tenant,
      );

      if (!bookable.autoCommitBooking) return false;
    }
    return true;
  }

  performRejected() {
    return false;
  }

  setPaymentMethod() {
    return "";
  }

  async getLockerInfo() {
    let lockerInfo = [];
    try {
      for (const bookableItem of this.bookableItems) {
        const lockerServiceInstance = LockerService.getInstance();
        lockerInfo = lockerInfo.concat(
          await lockerServiceInstance.getAvailableLocker(
            bookableItem.bookableId,
            this.tenant,
            this.timeBegin,
            this.timeEnd,
            bookableItem.amount,
          ),
        );
      }
    } catch (error) {
      throw new Error(error);
    }
    return lockerInfo;
  }

  processAttachments(bookableItems, attachmentStatus) {
    const attachments = bookableItems.reduce((acc, bookableItem) => {
      const itemAttachments = bookableItem._bookableUsed.attachments.map(
        (attachment) => {
          attachment.bookableId = bookableItem.bookableId;
          return attachment;
        },
      );
      return acc.concat(itemAttachments);
    }, []);

    return attachments.map((attachment) => {
      const status = attachmentStatus?.find(
        (status) => status.id === attachment.id,
      );
      return {
        type: attachment.type,
        title: attachment.title,
        bookableId: attachment.bookableId,
        url: attachment.url,
        accepted: status ? status.accepted : undefined,
      };
    });
  }

  /**
   * Prepares a booking by checking all bookable items and generating a booking reference.
   *
   * @async
   * @function prepareBooking
   * @param {Object} [options={}] - The options for preparing the booking.
   * @param {boolean} [options.keepExistingId=false] - Whether to keep the existing booking ID.
   * @param {string|null} [options.existingId=null] - The existing booking ID to keep, if any.
   * @returns {Promise<Booking>} - A promise that resolves to the prepared booking object.
   */
  async prepareBooking({ keepExistingId = false, existingId = null } = {}) {
    await this.checkAll();

    for (const bookableItem of this.bookableItems) {
      const itemCheckoutService =
        await this.createItemCheckoutService(bookableItem);
      bookableItem.regularPriceEur =
        await itemCheckoutService.regularPriceEur();
      bookableItem.regularGrossPriceEur =
        await itemCheckoutService.regularGrossPriceEur();
      bookableItem.userPriceEur = await itemCheckoutService.userPriceEur();
      bookableItem.userGrossPriceEur =
        await itemCheckoutService.userGrossPriceEur();

      bookableItem._bookableUsed = itemCheckoutService.bookableUsed;
      delete bookableItem._bookableUsed._id;
    }

    const booking = {
      id:
        keepExistingId && existingId
          ? existingId
          : await this.generateBookingReference(),
      tenantId: this.tenant,
      assignedUserId: this.user,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      timeCreated: this.timeCreated,
      bookableItems: this.bookableItems,
      couponCode: this.couponCode,
      name: this.name,
      company: this.company,
      street: this.street,
      zipCode: this.zipCode,
      location: this.location,
      mail: this.email,
      phone: this.phone,
      comment: this.comment,
      attachments: this.processAttachments(
        this.bookableItems,
        this.attachmentStatus,
      ),
      priceEur: await this.userGrossPriceEur(),
      vatIncludedEur: await this.vatIncludedEur(),
      isCommitted: await this.isAutoCommit(),
      isPayed: await this.isPaymentComplete(),
      isRejected: this.performRejected(),
      paymentProvider: this.paymentProvider,
      paymentMethod: this.setPaymentMethod(),
      lockerInfo: await this.getLockerInfo(),
    };

    if (this.couponCode) {
      booking._couponUsed = await CouponManager.getCoupon(
        this.couponCode,
        this.tenant,
      );
      delete booking._couponUsed._id;
    }

    return booking;
  }
}

/**
 * Class representing a manual bundle checkout service.
 * @extends BundleCheckoutService
 */
class ManualBundleCheckoutService extends BundleCheckoutService {
  /**
   * Create a manual bundle checkout service.
   * @param {string} user - The user ID.
   * @param {string} tenant - The tenant ID.
   * @param {Date} timeBegin - The start time.
   * @param {Date} timeEnd - The end time.
   * @param timeCreated - The creation time.
   * @param {Array} bookableItems - The items to be booked.
   * @param {string} couponCode - The coupon code.
   * @param {string} name - The name of the user.
   * @param {string} company - The company of the user.
   * @param {string} street - The street of the user.
   * @param {string} zipCode - The zip code of the user.
   * @param {string} location - The location of the user.
   * @param {string} email - The email of the user.
   * @param {string} phone - The phone number of the user.
   * @param {string} comment - The comment of the user.
   * @param {boolean} isCommit - The commit status.
   * @param {boolean} isPayed - The payment status.
   * @param {boolean} isRejected - The reject status.
   * @param {Array} attachmentStatus - The attachments of the user.
   * @param {string} paymentProvider - The payment method.
   * @param {string} paymentMethod - The payment method.
   * @param {Array} hooks - The hooks.
   */
  constructor(
    user,
    tenant,
    timeBegin,
    timeEnd,
    timeCreated,
    bookableItems,
    couponCode,
    name,
    company,
    street,
    zipCode,
    location,
    email,
    phone,
    comment,
    isCommit,
    isPayed,
    isRejected,
    attachmentStatus,
    paymentProvider,
    paymentMethod,
    hooks,
  ) {
    super(
      user,
      tenant,
      timeBegin,
      timeEnd,
      timeCreated,
      bookableItems,
      couponCode,
      name,
      company,
      street,
      zipCode,
      location,
      email,
      phone,
      comment,
      attachmentStatus,
      paymentProvider,
    );
    this.isCommitted = isCommit;
    this.isPayed = isPayed;
    this.isRejected = isRejected;
    this.paymentMethod = paymentMethod;
    this.hooks = hooks;
  }

  async createItemCheckoutService(bookableItem) {
    const itemCheckoutService = new ManualItemCheckoutService(
      this.user,
      this.tenant,
      this.timeBegin,
      this.timeEnd,
      bookableItem.bookableId,
      bookableItem.amount,
      this.couponCode,
    );

    await itemCheckoutService.init(bookableItem._bookableUsed);

    return itemCheckoutService;
  }

  checkAll() {
    return true;
  }

  async isAutoCommit() {
    if (
      this.isCommitted !== undefined &&
      typeof this.isCommitted === "boolean"
    ) {
      return this.isCommitted;
    } else {
      return await super.isAutoCommit();
    }
  }

  async isPaymentComplete() {
    if (this.isPayed !== undefined && typeof this.isPayed === "boolean") {
      return this.isPayed;
    } else {
      return await super.isPaymentComplete();
    }
  }

  performRejected() {
    return this.isRejected;
  }

  setPaymentMethod() {
    return this.paymentMethod;
  }
}

module.exports = {
  BundleCheckoutService,
  ManualBundleCheckoutService,
};
