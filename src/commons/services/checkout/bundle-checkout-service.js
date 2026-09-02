const { ItemCheckoutService } = require("./item-checkout-service");
const checkoutPolicy = require("./checkout-policy");
const { CheckoutPolicy } = checkoutPolicy;
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
   * @param {boolean} bookWithoutDiscount - Request wish to ignore booking
   *   discounts. Only honored under SELF_SERVICE; ADMIN_MANUAL always
   *   suppresses discounts.
   * @param {string} checkoutId - The checkout ID.
   * @param {Array} customFieldValues - Checkout custom field values.
   * @param {string|null} amendedBookingId - The booking being amended, if any.
   *   Server-derived; excluded from capacity checks so an update never
   *   collides with itself.
   * @param {string} [policy] - The checkout policy (see checkout-policy.js).
   * @param {Object} [adminOverrides] - ADMIN_MANUAL only: admin-authoritative
   *   values. Passing this under SELF_SERVICE is an error.
   * @param {string} [adminOverrides.internalComments]
   * @param {string} [adminOverrides.rejectionReason]
   * @param {boolean} [adminOverrides.isCommitted]
   * @param {boolean} [adminOverrides.isPayed]
   * @param {boolean} [adminOverrides.isRejected]
   * @param {string} [adminOverrides.paymentMethod]
   * @param {Array} [adminOverrides.lockerInfo] - Reused when non-empty.
   * @param {Array} [adminOverrides.accessInfo]
   * @param {Object} [adminOverrides.cancellationPolicy] - Replaces the policy
   *   aggregated from the bookables.
   */
  constructor(
    {
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
      amendedBookingId,
    },
    policy = CheckoutPolicy.SELF_SERVICE,
    adminOverrides = undefined,
  ) {
    this.policy = checkoutPolicy.assertCheckoutPolicy(policy);
    if (adminOverrides && !checkoutPolicy.acceptsAdminOverrides(policy)) {
      throw new Error(
        "adminOverrides are only accepted under the ADMIN_MANUAL checkout policy",
      );
    }
    this.adminOverrides = adminOverrides || {};
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
    this.bookWithoutDiscount = checkoutPolicy.bookWithoutDiscount(
      this.policy,
      bookWithoutDiscount,
    );
    this.checkoutId = checkoutId;
    this.customFieldValues = Array.isArray(customFieldValues)
      ? customFieldValues
      : [];
    this.amendedBookingId = amendedBookingId || null;
    if (!checkoutPolicy.acceptsManualPrice(this.policy)) {
      // Never let a client-supplied manual price reach the stored booking —
      // a later admin update would honor it.
      for (const item of this.bookableItems || []) {
        delete item.manualPriceEur;
      }
    }
    // One cache shared by all items of the bundle, so external providers are
    // asked once per checkout instead of once per item.
    this.externalCache = new Map();
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
    const itemCheckoutService = new ItemCheckoutService(
      {
        user: this.user,
        tenantId: this.tenant,
        timeBegin: this.timeBegin,
        timeEnd: this.timeEnd,
        bookableId: bookableItem.bookableId,
        amount: bookableItem.amount,
        couponCode: await this._itemCouponCode(),
        bookWithoutDiscount: this.bookWithoutDiscount,
        checkoutId: this.checkoutId,
        excludeBookingIds: this.amendedBookingId ? [this.amendedBookingId] : [],
        externalCache: this.externalCache,
        manualPriceEur: bookableItem.manualPriceEur,
      },
      this.policy,
    );

    // Under ADMIN_MANUAL the admin-edited bookable snapshot drives pricing;
    // without one (or under SELF_SERVICE) the stored bookable is loaded.
    await itemCheckoutService.init(
      checkoutPolicy.acceptsAdminOverrides(this.policy)
        ? bookableItem._bookableUsed
        : null,
    );

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
    if (typeof this.adminOverrides.isPayed === "boolean") {
      return this.adminOverrides.isPayed;
    }
    return (await this.userPriceEur()) === 0;
  }

  async isAutoCommit() {
    if (typeof this.adminOverrides.isCommitted === "boolean") {
      return this.adminOverrides.isCommitted;
    }
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
    if (typeof this.adminOverrides.isRejected === "boolean") {
      return this.adminOverrides.isRejected;
    }
    return false;
  }

  setPaymentMethod() {
    return this.adminOverrides.paymentMethod ?? "";
  }

  async getLockerInfo() {
    if (this.adminOverrides.lockerInfo?.length > 0) {
      return this.adminOverrides.lockerInfo;
    }
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
        reference: attachment.reference || undefined,
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

    if (checkoutPolicy.acceptsAdminOverrides(this.policy)) {
      // The admin books on behalf of the customer: the booking belongs to the
      // customer's mail address, not to the admin who entered it.
      booking.assignedUserId = primaryEmailFromMail(this.email);
      booking.internalComments = this.adminOverrides.internalComments || "";
      booking.rejectionReason = this.adminOverrides.rejectionReason || "";
      booking.accessInfo = this.adminOverrides.accessInfo || [];

      if (
        this.adminOverrides.cancellationPolicy &&
        typeof this.adminOverrides.cancellationPolicy === "object"
      ) {
        booking.cancellationPolicy = {
          ...booking.cancellationPolicy,
          ...this.adminOverrides.cancellationPolicy,
        };
      }
    }

    return booking;
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
};
