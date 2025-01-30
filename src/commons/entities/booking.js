/**
 * A Booking object represents a single reservation of a resource by exactly one user.
 */
class Booking {
  /**
   * Constructs a new Booking object.
   *
   * @param {Object} params - The parameters for the booking.
   * @param {string} params.id - The unique identifier for the booking.
   * @param {string} params.tenant - The tenant identifier.
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
   */
  constructor({
    id,
    tenant,
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
    street,
    timeBegin,
    timeCreated,
    timeEnd,
    vatIncludedEur,
    zipCode,
  }) {
    this.id = id || "";
    this.tenant = tenant;
    this.assignedUserId = assignedUserId;
    this.attachments = attachments;
    this.bookableItems = bookableItems;
    this.comment = comment;
    this.company = company;
    this.couponCode = couponCode;
    this.isCommitted = isCommitted;
    this.isPayed = isPayed;
    this.location = location;
    this.lockerInfo = lockerInfo;
    this.mail = mail;
    this.name = name;
    this.paymentProvider = paymentProvider;
    this.paymentMethod = paymentMethod;
    this.phone = phone;
    this.priceEur = priceEur;
    this.street = street;
    this.tenant = tenant;
    this.timeBegin = timeBegin;
    this.timeCreated = timeCreated;
    this.timeEnd = timeEnd;
    this.vatIncludedEur = vatIncludedEur;
    this.zipCode = zipCode;
  }

  /**
   * Commit this booking.
   */
  commit() {
    this.isCommitted = true;
  }
}

module.exports = {
  Booking: Booking,
};
