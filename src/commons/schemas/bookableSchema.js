const { Double } = require("mongodb");
const { Schema } = require("mongoose");

const priceCategorySchemaDefinition = {
  priceEur: { type: Number, required: true },
  interval: {
    type: Object,
    default: { start: null, end: null },
  },
  fixedPrice: { type: Boolean, default: false },
  holidays: { type: [Object], default: [] },
  weekdays: { type: [Number], default: [] },
};

const attachmentSchemaDefinition = {
  id: { type: String, required: true },
  title: { type: String, required: true },
  caption: { type: String, default: "" },
  type: { type: String, required: true },
  url: { type: String, required: true },
  show: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  mailAttach: { type: Boolean, default: false },
};

const bookableSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },

  // Basic properties
  type: { type: String, enum: ["room", "location", "resource", "ticket"] },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  isPublic: { type: Boolean, default: false },
  imgUrl: { type: String, default: "" },
  flags: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  location: {
    type: Object,
    default: {
      coordinates: {
        type: "Point",
        points: [null, null],
      },
      display_address: "",
      address: {
        street: null,
        house_number: null,
        post_code: null,
        city: null,
        suburb: null,
        state: null,
        country: null,
        country_code: null,
      },
      meta: {},
    },
  },

  // Booking properties
  isBookable: { type: Boolean, default: false },
  amount: { type: Number, default: null },
  minBookingDuration: { type: Number, default: null },
  maxBookingDuration: { type: Number, default: null },
  autoCommitBooking: { type: Boolean, default: false },
  bookingNotes: { type: String, default: "" },
  groupBooking: {
    type: Object,
    default: { enabled: false, permittedRoles: [] },
  },

  // Schedule properties
  isScheduleRelated: { type: Boolean, default: false },
  isTimePeriodRelated: { type: Boolean, default: false },
  timePeriods: { type: [Object], default: [] },
  isOpeningHoursRelated: { type: Boolean, default: false },
  openingHours: { type: [Object], default: [] },
  isSpecialOpeningHoursRelated: { type: Boolean, default: false },
  specialOpeningHours: { type: [Object], default: [] },
  isLongRange: { type: Boolean, default: false },
  longRangeOptions: { type: Object, default: null },

  // Price properties
  priceCategories: {
    type: [new Schema(priceCategorySchemaDefinition, { _id: false })],
    default: [
      {
        priceEur: 0,
        interval: { start: null, end: null },
        fixedPrice: false,
        holidays: [],
        weekdays: [],
      },
    ],
  },
  priceType: {
    type: String,
    enum: ["per-hour", "per-day", "per-item", "per-square-meter"],
    default: "per-item",
  },
  priceValueAddedTax: { type: Number, default: 0 },
  enableCoupons: { type: Boolean, default: true },

  // Permission properties
  permittedUsers: { type: [String], default: [] },
  permittedRoles: { type: [String], default: [] },
  freeBookingUsers: { type: [String], default: [] },
  freeBookingRoles: { type: [String], default: [] },

  // Relationship properties
  relatedBookableIds: { type: [String], default: [] },
  checkoutBookableIds: { type: [Object], default: [] },
  eventId: { type: String, default: "" },
  ownerUserId: { type: String, default: "" },

  // Additional properties
  attachments: {
    type: [new Schema(attachmentSchemaDefinition, { _id: false })],
    default: [],
  },
  lockerDetails: { type: Object, default: { active: false, units: [] } },
  requiredFields: { type: [String], default: [] },

  // Timestamps
  timeCreated: { type: Double, default: () => Date.now() },
  timeUpdated: { type: Double, default: () => Date.now() },
};

module.exports = {
  bookableSchemaDefinition,
};
