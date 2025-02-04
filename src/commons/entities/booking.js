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
   * Constructs a new Booking object.
   *
   * @param {Object} params - The parameters for the booking.
   * @param {string} params.id - The unique identifier for the booking.
   * @param {string} params.tenantId - The tenant identifier.
   * @param {string} params.assignedUserId - The ID of the user assigned to the booking.
   * @param {Array} params.attachments - The attachments associated with the booking.
   * @param {Array} params.bookableItems - The items that can be booked.
   * @param {string} params.comment - The comment for the booking.
   * @param {string} params.company - The company associated with the booking.
   * @param {string} params.couponCode - The coupon code used for the booking.
   * @param {boolean} params.isCommitted - Whether the booking is committed.
   * @param {boolean} params.isPayed - Whether the booking is paid.
   * @param {string} params.location - The location of the booking.
   * @param {Array} params.lockerInfo - The locker information for the booking.
   * @param {string} params.mail - The email address associated with the booking.
   * @param {string} params.name - The name associated with the booking.
   * @param {string} params.paymentProvider - The payment provider used for the booking.
   * @param {string} params.paymentMethod - The payment method used for the booking.
   * @param {string} params.phone - The phone number associated with the booking.
   * @param {number} params.priceEur - The price of the booking in euros.
   * @param {string} params.street - The street address associated with the booking.
   * @param {Date} params.timeBegin - The start time of the booking.
   * @param {Date} params.timeCreated - The creation time of the booking.
   * @param {Date} params.timeEnd - The end time of the booking.
   * @param {number} params.vatIncludedEur - The VAT included in the price in euros.
   * @param {string} params.zipCode - The zip code associated with the booking.
   * @param {string} id Identifier of the booking
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
   * @param {array<object>} hooks List of hooks
   */
  constructor({
    id,
    tenantId,
    assignedUserId,
    attachments,
    bookableItems,
    comment,
    company,
    couponCode,
    isCommitted,
    isPayed,
    location,
    lockerInfo,
    mail,
    name,
    paymentProvider,
    paymentMethod,
    phone,
    priceEur,
    timeBegin,
    timeCreated,
    timeEnd,
    vatIncludedEur,
    zipCode,
    street,
    couponUsed,
    hooks,
  } = {}) {
    this.id = id;
    this.tenantId = tenantId;
    this.assignedUserId = assignedUserId;
    this.attachments = attachments;
    this.bookableItems = bookableItems;
    this.comment = comment;
    this.company = company;
    this.couponCode = couponCode;
    this.location = location;
    this.lockerInfo = lockerInfo;
    this.mail = mail;
    this.name = name;
    this.paymentProvider = paymentProvider;
    this.paymentMethod = paymentMethod;
    this.phone = phone;
    this.priceEur = priceEur;
    this.street = street;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.vatIncludedEur = vatIncludedEur;
    this.zipCode = zipCode;
    this.timeCreated = timeCreated || Date.now();
    this.isCommitted = isCommitted || false;
    this.isPayed = isPayed || false;
    this.couponUsed = couponUsed || {};
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

  static schema() {
    return {
      tenantId: {
        type: String,
        required: true,
        ref: "Tenant",
      },
      assignedUserId: {
        type: String,
        ref: "User",
      },
      attachments: [Object],
      bookableItems: [Object],
      comment: String,
      company: String,
      couponCode: String,
      isCommitted: Boolean,
      isPayed: Boolean,
      location: String,
      lockerInfo: [Object],
      mail: String,
      name: String,
      paymentProvider: String,
      paymentMethod: String,
      phone: String,
      priceEur: Number,
      street: String,
      timeBegin: Date,
      timeCreated: Date,
      timeEnd: Date,
      vatIncludedEur: Number,
      zipCode: String,
      couponUsed: Object,
      hooks: [Object],
    };
  }
}

module.exports = {
  Booking: Booking,
  BookingHook: BookingHook,
  BOOKING_HOOK_TYPES: BOOKING_HOOK_TYPES,
};
