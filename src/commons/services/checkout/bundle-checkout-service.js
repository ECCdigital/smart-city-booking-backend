const {
  ItemCheckoutService,
  ManualItemCheckoutService,
} = require("./item-checkout-service");
const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const CouponManager = require("../../data-managers/coupon-manager");
const { COUPON_TYPE } = require("../../entities/coupon/coupon");
const LockerService = require("../locker/locker-service");
const { primaryEmailFromMail } = require("../../utilities/checkout-utils");

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
   * @param {Date} timePaid - The payment time.
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
   * @param {Array} attachments - The attachments.
   * @param {boolean} bookWithoutDiscount - When true, booking discounts are ignored.
   * @param {string} checkoutId - The checkout ID.
   * @param {Array} customFieldValues - Checkout custom field values.
   */
  constructor({
    user,
    tenant,
    timeBegin,
    timeEnd,
    timeCreated,
    timePaid,
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
    attachments,
    bookWithoutDiscount,
    checkoutId,
    customFieldValues,
  }) {
    this.user = user;
    this.tenant = tenant;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.timeCreated = timeCreated || Date.now();
    this.timePaid = timePaid;
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
    this.attachments = attachments || [];
    this.bookWithoutDiscount = bookWithoutDiscount;
    this.checkoutId = checkoutId;
    this.customFieldValues = Array.isArray(customFieldValues)
      ? customFieldValues
      : [];
  }

  async _getUsedCoupon() {
    if (!this.couponCode) {
      return null;
    }
    if (this._usedCoupon !== undefined) {
      return this._usedCoupon;
    }
    this._usedCoupon = await CouponManager.getCoupon(
      this.couponCode,
      this.tenant,
    );
    return this._usedCoupon;
  }

  async _isMultiItemFixedCoupon() {
    if (!this.couponCode || this.bookableItems.length <= 1) {
      return false;
    }
    const coupon = await this._getUsedCoupon();
    return coupon?.type === COUPON_TYPE.FIXED;
  }

  async _itemCouponCode() {
    if (!this.couponCode) {
      return null;
    }
    if (await this._isMultiItemFixedCoupon()) {
      return null;
    }
    return this.couponCode;
  }

  async createItemCheckoutService(bookableItem) {
    const itemCheckoutService = new ItemCheckoutService({
      user: this.user,
      tenantId: this.tenant,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      bookableId: bookableItem.bookableId,
      amount: bookableItem.amount,
      couponCode: await this._itemCouponCode(),
      bookWithoutDiscount: this.bookWithoutDiscount,
      checkoutId: this.checkoutId,
    });
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
      let itemCheckoutService = null;
      try {
        itemCheckoutService =
          await this.createItemCheckoutService(bookableItem);
        await itemCheckoutService.checkAll();
      } finally {
        if (itemCheckoutService) {
          itemCheckoutService.cleanup();
          itemCheckoutService = null;
        }
      }
    }

    return true;
  }

  /**
   * Run per-item checks and enrich bookable items with prices in one pass
   * so each ItemCheckoutService is initialized only once.
   * @returns {Promise<{freeBookingAllowed: boolean, bookingDiscountPercent: number}>}
   */
  async _checkAndEnrichBookableItemPrices() {
    let freeBookingAllowed = true;
    let bookingDiscountPercent = 0;

    for (let i = 0; i < this.bookableItems.length; i++) {
      const bookableItem = this.bookableItems[i];
      let itemCheckoutService = null;
      try {
        itemCheckoutService =
          await this.createItemCheckoutService(bookableItem);
        await itemCheckoutService.checkAll();

        bookableItem.regularPriceEur =
          await itemCheckoutService.regularPriceEur();
        bookableItem.regularGrossPriceEur =
          await itemCheckoutService.regularGrossPriceEur();
        bookableItem.userPriceEur = await itemCheckoutService.userPriceEur();
        bookableItem.userGrossPriceEur =
          await itemCheckoutService.userGrossPriceEur();
        bookableItem._bookableUsed = itemCheckoutService.bookableUsed;
        bookableItem.ignoreAmount = itemCheckoutService.ignoreAmount;
        delete bookableItem._bookableUsed._id;

        if (!(await itemCheckoutService.freeBookingAllowed())) {
          freeBookingAllowed = false;
        }
        if (i === 0) {
          bookingDiscountPercent =
            await itemCheckoutService.bookingDiscountPercent();
        }
      } finally {
        if (itemCheckoutService) {
          itemCheckoutService.cleanup();
          itemCheckoutService = null;
        }
      }
    }

    return { freeBookingAllowed, bookingDiscountPercent };
  }

  async userPriceEur() {
    let total = 0;
    for (const bookableItem of this.bookableItems) {
      const multiplier = bookableItem.ignoreAmount ? 1 : bookableItem.amount;
      total += bookableItem.userPriceEur * multiplier;
    }
    total = Math.round(total * 100) / 100;

    if (await this._isMultiItemFixedCoupon()) {
      const grossAfter = await this.userGrossPriceEur();
      let grossBefore = 0;
      for (const bookableItem of this.bookableItems) {
        const multiplier = bookableItem.ignoreAmount ? 1 : bookableItem.amount;
        grossBefore += bookableItem.userGrossPriceEur * multiplier;
      }
      grossBefore = Math.round(grossBefore * 100) / 100;
      if (!grossBefore) {
        return 0;
      }
      return Math.round(((total * grossAfter) / grossBefore) * 100) / 100;
    }

    return total;
  }

  async userGrossPriceEur() {
    let total = 0;
    for (const bookableItem of this.bookableItems) {
      const multiplier = bookableItem.ignoreAmount ? 1 : bookableItem.amount;
      total += bookableItem.userGrossPriceEur * multiplier;
    }
    total = Math.round(total * 100) / 100;

    if (await this._isMultiItemFixedCoupon()) {
      const coupon = await this._getUsedCoupon();
      return Math.max(0, Math.round((total - coupon.discount) * 100) / 100);
    }

    return total;
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

  /**
   * Aggregate the cancellation policy of all bookable items in the bundle.
   * Restrictive rule: every item must allow user cancellation, otherwise the
   * resulting booking is not user-cancellable.
   * @param {Array} bookableItems Bookable items with `_bookableUsed` populated.
   * @returns {{userCancellable: boolean, contactHint?: string}} Aggregated policy.
   */
  aggregateCancellationPolicy(bookableItems) {
    const userCancellable = bookableItems.every(
      (item) =>
        item._bookableUsed?.cancellationPolicy?.userCancellable === true,
    );

    if (userCancellable) {
      return { userCancellable };
    }

    const contactHints = [
      ...new Set(
        bookableItems
          .filter(
            (item) =>
              item._bookableUsed?.cancellationPolicy?.userCancellable !== true,
          )
          .map((item) =>
            item._bookableUsed?.cancellationPolicy?.contactHint?.trim(),
          )
          .filter(Boolean),
      ),
    ];

    if (contactHints.length === 0) {
      return { userCancellable };
    }

    return {
      userCancellable,
      contactHint: contactHints.join("\n\n"),
    };
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
        mailAttach: attachment.mailAttach,
      };
    });
  }

  /**
   * Validate all items and return aggregate prices without creating a booking.
   * Throws the same check errors as checkAll() / prepareBooking().
   * @returns {Promise<{
   *   regularPriceEur: number,
   *   userPriceEur: number,
   *   regularGrossPriceEur: number,
   *   userGrossPriceEur: number,
   *   freeBookingAllowed: boolean,
   *   bookingDiscountPercent: number
   * }>}
   */
  async validateAndGetPrices() {
    const { freeBookingAllowed, bookingDiscountPercent } =
      await this._checkAndEnrichBookableItemPrices();

    let regularPriceEur = 0;
    let regularGrossPriceEur = 0;
    for (const bookableItem of this.bookableItems) {
      const multiplier = bookableItem.ignoreAmount ? 1 : bookableItem.amount;
      regularPriceEur += bookableItem.regularPriceEur * multiplier;
      regularGrossPriceEur += bookableItem.regularGrossPriceEur * multiplier;
    }

    return {
      regularPriceEur: Math.round(regularPriceEur * 100) / 100,
      userPriceEur: await this.userPriceEur(),
      regularGrossPriceEur: Math.round(regularGrossPriceEur * 100) / 100,
      userGrossPriceEur: await this.userGrossPriceEur(),
      freeBookingAllowed,
      bookingDiscountPercent,
    };
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
    await this._checkAndEnrichBookableItemPrices();

    const mergedAttachments = mergeAttachments(
      this.attachments,
      this.processAttachments(this.bookableItems, this.attachmentStatus),
    );

    const cancellationPolicy = this.aggregateCancellationPolicy(
      this.bookableItems,
    );

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
      timePaid: this.timePaid,
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
      attachments: mergedAttachments,
      priceEur: await this.userGrossPriceEur(),
      vatIncludedEur: await this.vatIncludedEur(),
      isCommitted: await this.isAutoCommit(),
      isPayed: await this.isPaymentComplete(),
      isRejected: this.performRejected(),
      paymentProvider: this.paymentProvider,
      paymentMethod: this.setPaymentMethod(),
      lockerInfo: await this.getLockerInfo(),
      customFieldValues: this.customFieldValues,
      cancellationPolicy,
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
   * @param {Date} timePaid - The payment time.
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
   * @param {string} internalComments - Internal comments for administrative purposes.
   * @param {string} rejectionReason - Reason for rejection if the booking is rejected.
   * @param {boolean} isCommit - The commit status.
   * @param {boolean} isPayed - The payment status.
   * @param {boolean} isRejected - The reject status.
   * @param {Array} attachmentStatus - The attachments of the user.
   * @param {string} paymentProvider - The payment method.
   * @param {string} paymentMethod - The payment method.
   * @param {Array} hooks - The hooks.
   * @param {Array} attachments - The attachments.
   * @param {boolean} bookWithoutDiscount - When true, booking discounts are ignored.
   * @param {string} checkoutId - The checkout ID.
   * @param {Array} lockerInfo - The locker info.
   * @param {Array} customFieldValues - Checkout custom field values.
   * @param {Object} [cancellationPolicy] - Admin override for the booking's
   *   cancellation policy. When provided, it replaces the value aggregated
   *   from the underlying bookables.
   */
  constructor({
    user,
    tenant,
    timeBegin,
    timeEnd,
    timePaid,
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
    internalComments,
    rejectionReason,
    isCommit,
    isPayed,
    isRejected,
    attachmentStatus,
    paymentProvider,
    paymentMethod,
    hooks,
    attachments,
    bookWithoutDiscount,
    checkoutId,
    lockerInfo,
    customFieldValues,
    cancellationPolicy,
  }) {
    super({
      user,
      tenant,
      timeBegin,
      timeEnd,
      timeCreated,
      timePaid,
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
      attachments,
      bookWithoutDiscount,
      checkoutId,
      customFieldValues,
    });
    this.isCommitted = isCommit;
    this.isPayed = isPayed;
    this.isRejected = isRejected;
    this.paymentMethod = paymentMethod;
    this.hooks = hooks;
    this.internalComments = internalComments || "";
    this.rejectionReason = rejectionReason || "";
    this.lockerInfo = lockerInfo || null;
    this.cancellationPolicyOverride = cancellationPolicy;
  }

  async createItemCheckoutService(bookableItem) {
    const itemCheckoutService = new ManualItemCheckoutService({
      user: this.user,
      tenantId: this.tenant,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      bookableId: bookableItem.bookableId,
      amount: bookableItem.amount,
      couponCode: await this._itemCouponCode(),
      bookWithoutDiscount: this.bookWithoutDiscount,
    });

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

  async prepareBooking(options = {}) {
    const booking = await super.prepareBooking(options);
    booking.assignedUserId = primaryEmailFromMail(this.email);
    booking.internalComments = this.internalComments;
    booking.rejectionReason = this.rejectionReason;

    if (
      this.cancellationPolicyOverride &&
      typeof this.cancellationPolicyOverride === "object"
    ) {
      booking.cancellationPolicy = {
        ...booking.cancellationPolicy,
        ...this.cancellationPolicyOverride,
      };
    }

    return booking;
  }

  async getLockerInfo() {
    if (this.lockerInfo && this.lockerInfo.length > 0) {
      return this.lockerInfo;
    }
    return super.getLockerInfo();
  }
}

function mergeAttachments(existingAttachments, newAttachments) {
  function dedupeKey(att) {
    return `${att.type}::${att.title}`;
  }

  const existingMap = existingAttachments.reduce((map, att) => {
    map[dedupeKey(att)] = att;
    return map;
  }, {});

  const newMap = newAttachments.reduce((map, att) => {
    map[dedupeKey(att)] = att;
    return map;
  }, {});

  const merged = [...existingAttachments];

  Object.entries(newMap).forEach(([key, att]) => {
    if (!existingMap[key]) {
      merged.push(att);
    }
  });

  return merged;
}

module.exports = {
  BundleCheckoutService,
  ManualBundleCheckoutService,
};
