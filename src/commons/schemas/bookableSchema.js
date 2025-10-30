const { Double } = require("mongodb");
const { Schema } = require("mongoose");

const BOOKING_KINDS = Object.freeze({
  QUANTITY: "quantity",
  TIME: "time",
});
const TIME_RELATIONS = Object.freeze({
  TIME_PERIOD: "time-period", // was previously isTimePeriodRelated
  LONG_RANGE_WEEK: "long-range-week", // new <-- longRangeOptions.type === "week"
  LONG_RANGE_MONTH: "long-range-month", // new <-- longRangeOptions.type === "month"
  SCHEDULE: "schedule", // was previously isScheduleRelated
});

const TYPES = Object.freeze({
  ROOM: "room",
  LOCATION: "location",
  RESOURCE: "resource",
  TICKET: "ticket",
});

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;
const validateWeekdays = (arr) =>
  Array.isArray(arr) &&
  arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 6);
const minutes = (hhmm) =>
  parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);

const openingHoursSchemaDefinition = {
  regular: {
    type: {
      enabled: { type: Boolean, default: false },
      hours: {
        type: [
          new Schema(
            {
              daysOfWeek: {
                type: [Number],
                required: true,
              }, // 0 (Sunday) to 6 (Saturday)
              openTime: {
                type: String,
                required: true,
                match: HHMM, // "HH:MM"
              },
              closeTime: {
                type: String,
                required: true,
                match: HHMM, // "HH:MM"
              },
            },
            { _id: false },
          ),
        ],
      },
    },
  },
  specific: {
    type: {
      enabled: { type: Boolean, default: false },
      hours: {
        type: [
          new Schema(
            {
              date: { type: String, required: true, match: YYYYMMDD }, // "YYYY-MM-DD"
              openTime: { type: String, required: true, match: HHMM }, // "HH:MM"
              closeTime: {
                type: String,
                required: true,
                match: HHMM,
              },
            },
            { _id: false },
          ),
        ],
      },
    },
  },
};

const timePeriodSchemaDefinition = {
  weekdays: { type: [Number], required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
};

const priceIntervalSchemaDefinition = {
  start: { type: Number, min: 0, max: 24, default: null },
  end: { type: Number, min: 0, max: 24, default: null },
};

const priceCategorySchemaDefinition = {
  priceEur: { type: Number, required: true, min: 0 },
  interval: {
    type: new Schema(priceIntervalSchemaDefinition, { _id: false }),
    default: { start: null, end: null },
  },
  fixedPrice: { type: Boolean, default: false },
  holidays: {
    type: [String],
    default: [],
  },
  weekdays: {
    type: [Number],
    default: [],
  },
};

const groupBookingSchemaDefinition = {
  enabled: { type: Boolean, default: false },
  permittedRoles: { type: [String], default: [] },
};

const bookableSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: {
    type: String,
    required: true,
    ref: "Tenant",
    immutable: true,
    index: true,
  },

  // Basic properties
  type: {
    type: String,
    enum: Object.values(TYPES),
    required: true,
    index: true,
  },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: "", maxlength: 5000 },
  bookingKind: {
    type: String,
    enum: Object.values(BOOKING_KINDS),
    default: BOOKING_KINDS.QUANTITY,
  },
  isPublic: { type: Boolean, default: false },
  imgUrl: { type: String, default: "", trim: true },
  flags: { type: [String], default: [] },
  tags: { type: [String], default: [], index: true },
  location: { type: String, default: "" },

  // Booking properties
  isBookable: { type: Boolean, default: false },
  amount: { type: Number, default: null, min: 0 },
  autoCommitBooking: { type: Boolean, default: false },
  bookingNotes: { type: String, default: "" },
  groupBooking: {
    type: new Schema(groupBookingSchemaDefinition, { _id: false }),
    default: { enabled: false, permittedRoles: [] },
  },

  // Schedule properties
  timeRelation: {
    type: String,
    enum: Object.values(TIME_RELATIONS),
    default: TIME_RELATIONS.SCHEDULE,
  },
  minBookingDuration: { type: Number, default: null },
  maxBookingDuration: { type: Number, default: null },
  timePeriods: {
    type: [new Schema(timePeriodSchemaDefinition, { _id: false })],
    default: [],
  },
  openingHours: {
    type: new Schema(openingHoursSchemaDefinition, { _id: false }),
    default: {
      regular: { enabled: false, hours: [] },
      specific: { enabled: false, hours: [] },
    },
  },

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
  attachments: { type: [Object], default: [] },
  lockerDetails: { type: Object, default: { active: false, units: [] } },
  requiredFields: { type: [String], default: [] },

  // Timestamps
  timeCreated: { type: Double, default: () => Date.now() },
  timeUpdated: { type: Double, default: () => Date.now() },
};

module.exports = {
  bookableSchemaDefinition,
  BOOKING_KINDS,
  TIME_RELATIONS,
};
