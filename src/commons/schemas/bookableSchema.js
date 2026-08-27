const { Double } = require("mongodb");
const { Schema } = require("mongoose");
const { customFieldDefinitionSchema } = require("./customFieldDefinition");
const { mediaReferenceSchema } = require("./mediaSchema");

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
  // The file of an attachment is a media reference; the context fields around
  // it stay here, at the usage site. `url` is the legacy raw address the media
  // import (B7) converts — it is read as an external reference until then.
  reference: { type: mediaReferenceSchema, default: undefined },
  url: { type: String, default: "" },
  show: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  mailAttach: { type: Boolean, default: false },
};

const customFieldValueSchema = new Schema(
  {
    fieldId: { type: String, required: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const blockPeriodSchemaDefinition = {
  id: { type: String, required: true },
  label: { type: String, required: true },
  startWeekday: {
    type: Number,
    required: true,
    min: 0,
    max: 6,
    validate: {
      validator: Number.isInteger,
      message: "startWeekday must be an integer",
    },
  },
  startTime: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/,
  },
  endWeekday: {
    type: Number,
    required: true,
    min: 0,
    max: 6,
    validate: {
      validator: Number.isInteger,
      message: "endWeekday must be an integer",
    },
  },
  endTime: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/,
  },
};

const serviceHoursSchemaDefinition = {
  weekdays: {
    type: [Number],
    required: true,
    validate: {
      validator: (value) =>
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (weekday) =>
            Number.isInteger(weekday) && weekday >= 0 && weekday <= 6,
        ),
      message: "weekdays must contain integers between 0 and 6",
    },
  },
  startTime: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/,
  },
  endTime: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/,
  },
};

const bookableSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },

  // Basic properties
  type: { type: String, enum: ["room", "location", "resource", "ticket"] },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  isPublic: { type: Boolean, default: false },
  // The ordered image list. Position 0 is the cover image — there is no field
  // of its own for it, reordering the list changes the cover.
  images: { type: [mediaReferenceSchema], default: [] },
  // Legacy single image, kept readable until the media import (B7) has moved
  // it into `images`. It is the fallback of the derived `imgUrl` export field,
  // never written by the application.
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
  preparationLeadTimeMinutes: { type: Number, default: null, min: 0 },
  serviceHours: {
    type: [new Schema(serviceHoursSchemaDefinition, { _id: false })],
    default: [],
  },
  bufferTimeBeforeMinutes: { type: Number, default: null, min: 0 },
  bufferTimeAfterMinutes: { type: Number, default: null, min: 0 },
  isSpecialOpeningHoursRelated: { type: Boolean, default: false },
  specialOpeningHours: { type: [Object], default: [] },
  isLongRange: { type: Boolean, default: false },
  longRangeOptions: { type: Object, default: null },
  isBlockPeriodRelated: { type: Boolean, default: false },
  blockPeriods: {
    type: [new Schema(blockPeriodSchemaDefinition, { _id: false })],
    default: [],
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
  requiresLogin: { type: Boolean, default: false },
  permittedUsers: { type: [String], default: [] },
  permittedRoles: { type: [String], default: [] },
  bookingDiscounts: {
    type: new Schema(
      {
        users: {
          type: [
            new Schema(
              {
                userId: { type: String, required: true },
                discountPercent: {
                  type: Number,
                  default: 0,
                  min: 0,
                  max: 100,
                  validate: {
                    validator: Number.isInteger,
                    message: "discountPercent must be an integer",
                  },
                },
              },
              { _id: false },
            ),
          ],
          default: [],
        },
        roles: {
          type: [
            new Schema(
              {
                roleId: { type: String, required: true },
                discountPercent: {
                  type: Number,
                  default: 0,
                  min: 0,
                  max: 100,
                  validate: {
                    validator: Number.isInteger,
                    message: "discountPercent must be an integer",
                  },
                },
              },
              { _id: false },
            ),
          ],
          default: [],
        },
      },
      { _id: false },
    ),
    default: { users: [], roles: [] },
  },

  // Cancellation policy
  cancellationPolicy: {
    type: Object,
    default: { userCancellable: true, contactHint: "" },
  },

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
  requiredFields: { type: [String], default: ["address", "zipCode", "city"] },

  externalProviders: {
    type: [
      new Schema(
        {
          active: { type: Boolean, default: false },
          provider: { type: String, required: true },
          handles: {
            type: [String],
            enum: ["pricing", "availability", "maxAmount"],
            default: [],
          },
          config: { type: Object, default: {} },
        },
        { _id: false },
      ),
    ],
    default: [],
  },

  customFieldDefinitions: {
    type: [customFieldDefinitionSchema],
    default: [],
  },

  customFieldValues: {
    type: [customFieldValueSchema],
    default: [],
  },

  // Timestamps
  timeCreated: { type: Double, default: () => Date.now() },
  timeUpdated: { type: Double, default: () => Date.now() },
};

module.exports = {
  bookableSchemaDefinition,
  blockPeriodSchemaDefinition,
  serviceHoursSchemaDefinition,
};
