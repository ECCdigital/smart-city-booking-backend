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
   * Constructs a new instance of the Bookable class.
   *
   * @param {Object} params The parameters for the bookable object.
   * @param {string} params.id Logical identifier of the bookable object.
   * @param {string} params.tenantId Tenant identifier.
   * @param {string} params.type Type class of the bookable object, determines whether object is a room, location, ticket or similar. NOTE: Please use BookableTypes!
   * @param {boolean} params.enabled true, if the object is enabled.
   * @param {string} params.parent Logical identifier of a parent bookable object, undefined if there is no parent.
   * @param {string} params.title Display Name of the bookable object.
   * @param {string} params.description Short description of the bookable object.
   * @param {array<string>} params.flags Set of strings used to indicate specific properties such as 'barrier-free'.
   * @param {string} params.imgUrl URL of the image representing the bookable object.
   * @param {double} params.priceEur Price of the resource in Euro.
   * @param {double} params.priceValueAddedTax Value added tax of the price.
   * @param {integer} params.amount Number of available bookable resources, e.g. 5 tickets.
   * @param {integer} params.minBookingDuration Minimum booking duration in minutes.
   * @param {integer} params.maxBookingDuration Maximum booking duration in minutes.
   * @param {boolean} params.autoCommitBooking true, if the resource is bookable without any manual management steps.
   * @param {string} params.location Location of the object, e.g. city and street.
   * @param {array<string>} params.tags Set of strings used for internal classification and filtering.
   * @param {boolean} params.isScheduleRelated true, if the bookable needs to be booked with a time schedule.
   * @param {boolean} params.isTimePeriodRelated true, if the bookable needs to be booked with a time period.
   * @param {array<Object>} params.timePeriods Array of time periods, e.g. [ { weekdays: [1,2], startTime: '08:00', endTime: '12:00' }, { weekdays: [3,4], begin: '13:00', end: '17:00' } ].
   * @param {boolean} params.isOpeningHoursRelated true, if the bookable needs to be booked with opening hours.
   * @param {boolean} params.isSpecialOpeningHoursRelated true, if the bookable needs to be booked with special opening hours.
   * @param {array<Object>} params.specialOpeningHours Array of special opening hours.
   * @param {boolean} params.isLongRange true, if the bookable is a long-range resource.
   * @param {Object} params.longRangeOptions Options for long-range booking.
   * @param {array<string>} params.permittedUsers Array of user ids that are allowed to book the resource.
   * @param {array<string>} params.permittedRoles Array of role ids that are allowed to book the resource.
   * @param {array<string>} params.freeBookingUsers Array of user ids that can book the resource for free.
   * @param {array<string>} params.freeBookingRoles Array of role ids that can book the resource for free.
   * @param {array<Object>} params.openingHours Array of opening hours.
   * @param {string} params.eventId The Id of a related event if applicable, otherwise this field stays undefined.
   * @param {array<Attachment>} params.attachments A list of attachments represented by their URLs.
   * @param {string} params.priceCategory The price category of the resource, e.g. per-hour, per-day.
   * @param {array<string>} params.relatedBookableIds Related bookable objects that have to be checked during booking.
   * @param {boolean} params.isBookable true, if the bookable object is bookable.
   * @param {boolean} params.isPublic true, if the bookable object is visible to the public.
   * @param {array<Object>} params.lockerDetails Details about the locker, e.g. locker number, locker size.
   * @param {array<string>} params.requiredFields List of required fields for the bookable object.
   * @param {string} params.bookingNotes Notes for the booking.
   * @param {array<string>} params.checkoutBookableIds Array of bookable ids required for checkout.
   * @param {string} params.ownerUserId The user id of the owner.
   */
  constructor({
    id,
    tenantId,
    parent,
    type,
    title,
    description,
    enabled,
    isPublic,
    imgUrl,
    flags,
    tags,
    location,
    isBookable,
    amount,
    minBookingDuration,
    maxBookingDuration,
    autoCommitBooking,
    bookingNotes,
    isScheduleRelated,
    isTimePeriodRelated,
    timePeriods,
    isOpeningHoursRelated,
    openingHours,
    isSpecialOpeningHoursRelated,
    specialOpeningHours,
    isLongRange,
    longRangeOptions,
    priceCategories,
    priceType,
    priceValueAddedTax,
    permittedUsers,
    permittedRoles,
    freeBookingUsers,
    freeBookingRoles,
    relatedBookableIds,
    checkoutBookableIds,
    attachments,
    lockerDetails,
    requiredFields,
    eventId,
    ownerUserId,
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.parent = parent;
    this.type = type;
    this.title = title;
    this.description = description;
    this.enabled = enabled;
    this.isPublic = isPublic || false;
    this.imgUrl = imgUrl;
    this.flags = flags || [];
    this.tags = tags || [];
    this.location = location;
    this.isBookable = isBookable || false;
    this.amount = amount;
    this.minBookingDuration = minBookingDuration;
    this.maxBookingDuration = maxBookingDuration;
    this.autoCommitBooking = autoCommitBooking;
    this.bookingNotes = bookingNotes || "";
    this.isScheduleRelated = isScheduleRelated;
    this.isTimePeriodRelated = isTimePeriodRelated || false;
    this.timePeriods = timePeriods || [];
    this.isOpeningHoursRelated = isOpeningHoursRelated || false;
    this.openingHours = openingHours || [];
    this.isSpecialOpeningHoursRelated = isSpecialOpeningHoursRelated || false;
    this.specialOpeningHours = specialOpeningHours || [];
    this.isLongRange = isLongRange;
    this.longRangeOptions = longRangeOptions || null;
    this.priceCategories = priceCategories || [];
    this.priceType = priceType;
    this.priceValueAddedTax = priceValueAddedTax || 0;
    this.permittedUsers = permittedUsers || [];
    this.permittedRoles = permittedRoles || [];
    this.freeBookingUsers = freeBookingUsers;
    this.freeBookingRoles = freeBookingRoles;
    this.relatedBookableIds = relatedBookableIds || [];
    this.checkoutBookableIds = checkoutBookableIds || [];
    this.attachments = attachments || [];
    this.lockerDetails = lockerDetails || { active: false, units: [] };
    this.requiredFields = requiredFields || [];
    this.eventId = eventId;
    this.ownerUserId = ownerUserId || "";
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
    const duration = (timeEnd - timeBegin) / 1000 / 60 / 60; // Hours
    if (this.priceType === "per-hour") {
      return Math.round(this.priceEur * duration * 100) / 100;
    } else if (this.priceType === "per-day") {
      return Math.round(((this.priceEur * duration) / 24) * 100) / 100;
    }

    return Math.round(this.priceEur * 100) / 100;
  }

  static get schema() {
    return {
      id: {
        type: String,
        required: true,
        unique: true,
      },
      tenantId: {
        type: String,
        required: true,
        ref: "Tenant",
      },
      type: String,
      enabled: Boolean,
      parent: String,
      title: String,
      description: String,
      flags: [String],
      imgUrl: String,
      priceCategories: [
        {
          _id: false,
          priceEur: Number,
          fixedPrice: Boolean,
          interval: {
            start: Number || null,
            end: Number || null,
          },
        },
      ],
      priceType: {
        type: String,
        enum: ["per-hour", "per-day", "per-item", "per-square-meter"],
        default: "per-item",
      },
      priceValueAddedTax: Number,
      amount: Number || null,
      minBookingDuration: Number,
      maxBookingDuration: Number,
      autoCommitBooking: Boolean,
      location: String,
      tags: [String],
      isScheduleRelated: Boolean,
      isTimePeriodRelated: Boolean,
      timePeriods: [Object],
      isOpeningHoursRelated: Boolean,
      openingHours: [Object],
      isSpecialOpeningHoursRelated: Boolean,
      specialOpeningHours: [Object],
      isLongRange: Boolean,
      longRangeOptions: Object,
      permittedUsers: [String],
      permittedRoles: [String],
      freeBookingUsers: [String],
      freeBookingRoles: [String],
      eventId: String,
      attachments: [Object],
      relatedBookableIds: [String],
      isBookable: Boolean,
      isPublic: Boolean,
      lockerDetails: {
        active: Boolean,
        units: [
          {
            _id: false,
            id: String,
            lockerSystem: String,
            unitId: String,
            amount: Number,
          },
        ],
      },
      requiredFields: [String],
      bookingNotes: String,
      checkoutBookableIds: [Object],
      ownerUserId: String,
    };
  }
}

module.exports = {
  Bookable: Bookable,
  BookableTypes: BookableTypes,
};
