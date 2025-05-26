const { Schema } = require("mongoose");
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
   * Constructs a new Bookable instance.
   *
   * @param {Object} params - The parameters for the Bookable.
   * @param {string} params.id - The unique identifier for the bookable.
   * @param {string} params.tenantId - The tenant identifier.
   * @param {string} [params.parent] - The parent bookable identifier.
   * @param {string} params.type - The type of the bookable.
   * @param {string} params.title - The title of the bookable.
   * @param {string} [params.description] - The description of the bookable.
   * @param {boolean} [params.isPublic] - Whether the bookable is public.
   * @param {string} [params.imgUrl] - The image URL of the bookable.
   * @param {Array<string>} [params.flags] - The flags associated with the bookable.
   * @param {Array<string>} [params.tags] - The tags associated with the bookable.
   * @param {string} [params.location] - The location of the bookable.
   * @param {boolean} [params.isBookable] - Whether the item is bookable.
   * @param {number} [params.amount] - The amount of the bookable.
   * @param {number} [params.minBookingDuration] - The minimum booking duration.
   * @param {number} [params.maxBookingDuration] - The maximum booking duration.
   * @param {boolean} [params.autoCommitBooking] - Whether the booking is auto-committed.
   * @param {string} [params.bookingNotes] - Notes related to the booking.
   * @param {Object} [params.groupBooking] - Whether recurring bookings are allowed.
   * @param {boolean} [params.isScheduleRelated] - Whether the bookable is schedule-related.
   * @param {boolean} [params.isTimePeriodRelated] - Whether the bookable is time-period related.
   * @param {Array<Object>} [params.timePeriods] - The time periods for the bookable.
   * @param {boolean} [params.isOpeningHoursRelated] - Whether the bookable is related to opening hours.
   * @param {Array<Object>} [params.openingHours] - The opening hours of the bookable.
   * @param {boolean} [params.isSpecialOpeningHoursRelated] - Whether the bookable has special opening hours.
   * @param {Array<Object>} [params.specialOpeningHours] - The special opening hours of the bookable.
   * @param {boolean} [params.isLongRange] - Whether the bookable is long-range.
   * @param {Object} [params.longRangeOptions] - The long-range options for the bookable.
   * @param {Array<Object>} [params.priceCategories] - The price categories for the bookable.
   * @param {string} params.priceType - The price type of the bookable.
   * @param {number} [params.priceValueAddedTax] - The value-added tax for the price.
   * @param {Array<string>} [params.permittedUsers] - The users permitted to book.
   * @param {Array<string>} [params.permittedRoles] - The roles permitted to book.
   * @param {Array<string>} [params.freeBookingUsers] - The users allowed to book for free.
   * @param {Array<string>} [params.freeBookingRoles] - The roles allowed to book for free.
   * @param {Array<string>} [params.relatedBookableIds] - The related bookable IDs.
   * @param {Array<Object>} [params.checkoutBookableIds] - The checkout bookable IDs.
   * @param {Array<Object>} [params.attachments] - The attachments for the bookable.
   * @param {Array<Object>} [params.lockerDetails] - The locker details for the bookable.
   * @param {Array<string>} [params.requiredFields] - The required fields for the bookable.
   * @param {string} [params.eventId] - The event ID associated with the bookable.
   * @param {string} [params.ownerUserId] - The owner user ID of the bookable.
   */
  constructor({
    id,
    tenantId,
    parent,

    type,
    title,
    description,
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
    groupBooking = { enabled: false, permittedRoles: [] },

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
    this.groupBooking = {
      enabled: groupBooking.enabled,
      permittedRoles: groupBooking.permittedRoles,
    };

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
    this.lockerDetails = lockerDetails || [];
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
      parent: String,
      title: String,
      description: String,
      flags: [String],
      imgUrl: String,
      priceCategories: [
        {
          _id: false,
          priceEur: {
            type: Number,
            set: function (value) {
              if (typeof value === "string") {
                value = value.replace(",", ".");
              }
              return typeof value === "number" ? value : parseFloat(value);
            },
          },
          fixedPrice: Boolean,
          interval: {
            start: Number || null,
            end: Number || null,
          },
          weekdays: {
            type: [
              {
                type: Number,
                enum: [0, 1, 2, 3, 4, 5, 6],
              },
            ],
            default: [],
          },
          holidays: {
            type: [
              {
                type: Object,
                default: {
                  countryCode: String,
                  stateCode: String,
                  title: String,
                }
              },
            ],
            default: [],
          }
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
      lockerDetails: [Object],
      requiredFields: [String],
      groupBooking: {
        type: Object,
        default: {
          enabled: false,
          permittedRoles: [],
        },
      },
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
