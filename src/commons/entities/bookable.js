const BookableTypes = Object.freeze({
  EVENT_LOCATION: "event-location",
  ROOM: "room",
  RESOURCE: "resource",
  TICKET: "ticket",
});

/**
 * A Bookable is every location, room, ticket, resource or similar that may be booked via the booking manager platform.
 */
class Bookable {
  /**
   *
   * @param {string} id Logical identifier of the bookable object
   * @param {string} tenant Tenant identifier
   * @param {String} type Type class of the bookable object, determines whether object is a room, location, ticket or similar. NOTE: Please use BookableTypes!
   * @param {boolean} enabled true, if the object is enabled
   * @param {string} parent Logical identifier of a parent bookable object, undefined if there is no parent
   * @param {string} title Display Name of the bookable object
   * @param {string} description Short description of the bookable object
   * @param {array<string>} flags Set of String used to indicate specific properties such as 'barrier-free'
   * @param {double} priceEur Price of the resource in Euro
   * @param {integer} amount Number of available bookable resource, e.g. 5 tickets
   * @param {boolean} autoCommitBooking true, if the resource is bookable without any manual management steps
   * @param {string} location Location of the object, e.g. city and street
   * @param {array<string>} tags Set of strings used for internal classification and filtering.
   * @param {boolean} isScheduleRelated true, if the bookable need to be booked with time schedule
   * @param {boolean} isTimePeriodRelated true, if the bookable need to be booked with time period
   * @param {array<Object>} timePeriods Array of time periods, e.g. [ { weekdays: [1,2], startTime: '08:00', endTime: '12:00' }, { weekdays: [3,4], begin: '13:00', end: '17:00' } ]
   * @param {boolean} isOpeningHoursRelated true, if the bookable need to be booked with time period
   * @param {array<Object>} openingHours Array of time periods, e.g. [ { weekdays: [1,2], startTime: '08:00', endTime: '12:00' }, { weekdays: [3,4], begin: '13:00', end: '17:00' } ]
   * @param {string} eventId The Id of a related event if applicable, otherwise this field stays undefined.
   * @param {array<Attachment>} attachments A list of attachments represented by its Urls
   * @param {string} priceCategory The price category of the resource, e.g. per-hour, per-day
   * @param {array<string>} relatedBookableIds related bookable objects that have to be checked during booking
   * @param {boolean} isBookable true, if the bookable object is bookable
   * @param {boolean} isPublic true, if the bookable object is visible to the public
   * @param lockerDetails Details about the locker, e.g. locker number, locker size
   * @param {array<string>} requiredFields List of required fields for the bookable object
   */
  constructor(
    id,
    tenant,
    type,
    enabled,
    parent,
    title,
    description,
    flags,
    priceEur,
    amount,
    autoCommitBooking,
    location,
    tags,
    isScheduleRelated,
    isTimePeriodRelated,
    timePeriods,
    isOpeningHoursRelated,
    openingHours,
    eventId,
    attachments,
    priceCategory,
    relatedBookableIds,
    isBookable,
    isPublic,
    lockerDetails,
    requiredFields,
  ) {
    this.id = id;
    this.tenant = tenant;
    this.type = type;
    this.enabled = enabled;
    this.parent = parent;
    this.title = title;
    this.description = description;
    this.flags = flags || [];
    this.priceEur = priceEur;
    this.amount = amount;
    this.autoCommitBooking = autoCommitBooking;
    this.location = location;
    this.tags = tags || [];
    this.isScheduleRelated = isScheduleRelated;
    this.isTimePeriodRelated = isTimePeriodRelated || false;
    this.timePeriods = timePeriods || [];
    this.isOpeningHoursRelated = isOpeningHoursRelated || false;
    this.openingHours = openingHours || [];
    this.eventId = eventId;
    this.attachments = attachments || [];
    this.priceEur = priceEur;
    this.relatedBookableIds = relatedBookableIds || [];
    this.isBookable = isBookable || false;
    this.isPublic = isPublic || false;
    this.lockerDetails = lockerDetails || [];
    this.requiredFields = requiredFields || [];
  }

  /**
   * Add a new tag to the bookable object.
   *
   * @param {string} tag Name of the tag
   */
  addTag(tag) {
    this.tags.push(tag);
  }

  /**
   * Remove the tag from the bookable object.
   *
   * @param {string} tag Name of the tag
   */
  removeTag(tag) {
    this.tags = this.tags.filter((t) => t !== tag);
  }

  /**
   * Add a flag to the bookable object.
   *
   * @param {string} flag Name of the flag
   */
  addFlag(flag) {
    this.flags.push(flag);
  }

  /**
   * Remove a flag from the bookable object.
   *
   * @param {string} flag Name of the flag
   */
  removeFlag(flag) {
    this.flags = this.flags.filter((t) => t !== flag);
  }

  /**
   * Add an attachment to the bookable object.
   * @param {Attachment} attachment The url to the attachment
   */
  addAttachment(attachment) {
    this.attachments.push(attachment);
  }

  /**
   * Remove an attachment from the bookable object.
   * @param {string} id the attachment id
   */
  removeAttachment(id) {
    this.attachments = this.attachments.filter((a) => a.id !== id);
  }

  /**
   * Calculate the price for the Bookable
   */
  getTotalPrice(timeBegin, timeEnd) {
    var duration = (timeEnd - timeBegin) / 1000 / 60 / 60; // Hours
    if (this.priceCategory === "per-hour") {
      return Math.round(this.priceEur * duration * 100) / 100;
    } else if (this.priceCategory === "per-day") {
      return Math.round(((this.priceEur * duration) / 24) * 100) / 100;
    }

    return Math.round(this.priceEur * 100) / 100;
  }
}

module.exports = {
  Bookable: Bookable,
  BookableTypes: BookableTypes,
};
