const { v4: uuidv4 } = require("uuid");

const BOOKING_HOOK_TYPES = Object.freeze({
  REJECT: "REJECT",
});

class BookingHook {
  constructor({ id, type, timeCreated, payload }) {
    this.id = id;
    this.type = type;
    this.timeCreated = timeCreated || Date.now();
    this.payload = payload;
  }
}

class Booking {
  /**
   * Create a new booking object.
   *
   * @param {string} id Identifier of the booking
   * @param {string} tenant Identifier of the tenant
   * @param {string} assignedUserId The foreign identifier of the user related to this booking
   * @param {string} mail e-mail address in case no user is assigned to the booking
   * @param {string} comment A free text comment by the user
   * @param {integer} timeBegin Timestamp for begin date/time of the booking
   * @param {integer} timeEnd Timestamp for end date/time of the booking
   * @param {integer} timeCreated Timestamp when the booking was initially created
   * @param {array<object>} bookableItems List of bookable items
   * @param {boolean} isCommitted true, if the booking is committed
   * @param {string} couponCode Coupon code used for the booking
   * @param {string} name Name of the person who made the booking
   * @param {string} company Company name
   * @param {string} street Street address
   * @param {string} zipCode Zip code
   * @param {string} location Location
   * @param {string} phone Phone number
   * @param {number} priceEur Price in Euros
   * @param {boolean} isPayed true, if the booking is paid
   * @param {object} couponUsed Details of the coupon used
   * @param {string} payMethod Payment method
   * @param {array<object>} hooks List of hooks
   */
  constructor({
    id,
    tenant,
    assignedUserId,
    mail,
    comment,
    timeBegin,
    timeEnd,
    timeCreated,
    bookableItems,
    isCommitted,
    couponCode,
    name,
    company,
    street,
    zipCode,
    location,
    phone,
    priceEur,
    isPayed,
    couponUsed,
    payMethod,
    hooks,
  } = {}) {
    this.id = id;
    this.tenant = tenant;
    this.assignedUserId = assignedUserId;
    this.mail = mail;
    this.comment = comment;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.timeCreated = timeCreated || Date.now();
    this.bookableItems = bookableItems || [];
    this.isCommitted = isCommitted || false;
    this.couponCode = couponCode;
    this.name = name;
    this.company = company;
    this.street = street;
    this.zipCode = zipCode;
    this.location = location;
    this.phone = phone;
    this.priceEur = priceEur;
    this.isPayed = isPayed || false;
    this.couponUsed = couponUsed || {};
    this.payMethod = payMethod;
    this.hooks = hooks || [];
  }

  addHook(type, payload) {
    if (!Object.values(BOOKING_HOOK_TYPES).includes(type)) {
      throw new Error(`Invalid hook type: ${type}`);
    }

    const hook = new BookingHook({
      id: uuidv4(),
      type: type,
      payload: payload,
    });

    this.hooks.push(hook);

    return hook;
  }
}

module.exports = {
  Booking: Booking,
  BookingHook: BookingHook,
  BOOKING_HOOK_TYPES: BOOKING_HOOK_TYPES,
};
