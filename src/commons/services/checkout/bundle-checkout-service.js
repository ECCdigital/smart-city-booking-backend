const ItemCheckoutService = require("./item-checkout-service");
const CouponManager = require("../../data-managers/coupon-manager");
const BookableManager = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");

class BookableItem {
  constructor(bookableId, tenant, amount) {
    this.bookableId = bookableId;
    this.tenant = tenant;
    this.amount = amount;
  }
}

class BundleCheckoutService {
  constructor(
    user,
    tenant,
    timeBegin,
    timeEnd,
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
    isCommitted = false,
    isPayed = false,
    priceEur = undefined,
  ) {
    this.user = user;
    this.tenant = tenant;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
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
    this.isCommitted = isCommitted;
    this.isPayed = isPayed;
    this.priceEur = priceEur;
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
      if (!!(await BookingManager.getBooking(text, this.tenant)._id)) {
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
      const itemCheckoutService = new ItemCheckoutService(
        this.user,
        this.tenant,
        this.timeBegin,
        this.timeEnd,
        bookableItem.bookableId,
        bookableItem.amount,
      );

      await itemCheckoutService.checkAll();
    }

    return true;
  }

  async userPriceEur(manualBooking) {
    let total = 0;
    if(!manualBooking) {
      for (const bookableItem of this.bookableItems) {
        const itemCheckoutService = new ItemCheckoutService(
          this.user,
          this.tenant,
          this.timeBegin,
          this.timeEnd,
          bookableItem.bookableId,
          bookableItem.amount,
          this.couponCode,
        );

        total += await itemCheckoutService.userPriceEur();
      }
    } else {
        total = this.priceEur;
    }

    return Math.round(total * 100) / 100;
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
  async prepareBooking(manualBooking) {
    if (!manualBooking) {
      await this.checkAll();
    }

    for (const bookableItem of this.bookableItems) {
      bookableItem._bookableUsed = await BookableManager.getBookable(
        bookableItem.bookableId,
        this.tenant,
      );
      delete bookableItem._bookableUsed._id;
    }

    const booking = {
      id: await this.generateBookingReference(),
      tenant: this.tenant,
      assignedUserId: this.user?.id,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      timeCreated: Date.now(),
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
      priceEur: await this.userPriceEur(manualBooking),
      isCommitted: manualBooking ? this.isCommitted : await this.isAutoCommit(),
      isPayed: manualBooking ? this.isPayed : (await this.userPriceEur()) === 0,
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

module.exports = BundleCheckoutService;
