/**
 * A Booking object represents a single reservation of a resource by exactly one user.
 */
class Booking {
  /**
   * Create a new booking object.
   *
   * @param {string} id Identifier of the booking, set undefined to generate random UUID
   * @param {string} tenant Identifier of the tenant
   * @param {string} bookableId The foreign identifier indicating the booked resource
   * @param {string} assignedUserId The foreign identifier of the user related to this booking
   * @param {string} mail e-mail address in case no user is assigned to the booking
   * @param {string} comment A free text comment by the user
   * @param {integer} timeBegin Timestamp for begin date/time of the booking
   * @param {integer} timeEnd Timestamp for end date/time of the booking
   * @param {integer} timeCreated Timestamp when the booking was initially created
   * @param {array<String>} bookableIds List of bookable ids
   * @param {boolean} isCommitted true, if the booking is committed
   * @param {array<object>} attachments
   */
  constructor(
    id,
    tenant,
    assignedUserId,
    mail,
    comment,
    timeBegin,
    timeEnd,
    timeCreated,
    bookableIds,
    isCommitted,
    attachments,
  ) {
    this.id = id;
    this.tenant = tenant;
    this.assignedUserId = assignedUserId;
    this.mail = mail;
    this.comment = comment;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.timeCreated = timeCreated || Date.now();
    this.bookableIds = bookableIds || [];
    this.isCommitted = isCommitted || false;
    this.attachments = attachments || [];
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
