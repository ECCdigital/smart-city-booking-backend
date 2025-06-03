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
   * @param {string} id Identifier of the booking
   * @param {string} tenantId The foreign identifier of the tenant related to this booking
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
    isRejected,
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
    _couponUsed,
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
    this.isRejected = isRejected || false;
    this._couponUsed = _couponUsed || {};
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

  removeHook(hookId) {
    const hookIndex = this.hooks.findIndex((hook) => hook.id === hookId);

    if (hookIndex === -1) {
      throw new Error(`Hook with ID ${hookId} not found`);
    }

    this.hooks.splice(hookIndex, 1);
  }

  static get schema() {
    return {
      id: { type: String, required: true, unique: true },
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
      isRejected: Boolean,
      location: String,
      lockerInfo: [],
      mail: String,
      name: String,
      paymentProvider: String,
      paymentMethod: String,
      phone: String,
      priceEur: Number,
      street: String,
      timeBegin: Number,
      timeCreated: Number,
      timeEnd: Number,
      vatIncludedEur: Number,
      zipCode: String,
      _couponUsed: Object,
      hooks: [Object],
    };
  }
}

module.exports = {
  Booking: Booking,
  BookingHook: BookingHook,
  BOOKING_HOOK_TYPES: BOOKING_HOOK_TYPES,
};
