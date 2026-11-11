const { Schema } = require("mongoose");
const {
  CUSTOMER_UPLOAD_FORMATS,
  UPLOAD_FIELD_CATEGORIES,
  UPLOAD_FIELD_TIMINGS,
  MAX_RETENTION_DAYS,
} = require("../services/customer-upload/customer-upload-rules");

/**
 * An upload field of a bookable (glossary "Upload-Feld"): what a customer
 * hands in as a customer upload. A list of its own next to the custom
 * fields; `customer-upload-rules.js` checks it against the tenant and the
 * instance before it is stored.
 */
const uploadFieldDefinitionSchema = new Schema(
  {
    // Stable: renaming or deleting the field keeps notes on bookings readable.
    id: { type: String, required: true },
    label: { type: String, required: true },
    hint: { type: String, default: "" },
    consentText: { type: String, default: "" },
    required: { type: Boolean, default: false },
    formats: { type: [{ type: String, enum: CUSTOMER_UPLOAD_FORMATS }] },
    // Null is the limit of the instance.
    maxFileSizeMb: { type: Number, default: null },
    category: {
      type: String,
      enum: Object.values(UPLOAD_FIELD_CATEGORIES),
      default: UPLOAD_FIELD_CATEGORIES.NORMAL,
    },
    timing: {
      type: String,
      enum: Object.values(UPLOAD_FIELD_TIMINGS),
      default: UPLOAD_FIELD_TIMINGS.CHECKOUT,
    },
    // Days before the start of the booking, for `afterConfirmation` only.
    // Null is the start itself.
    deadlineDaysBeforeStart: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

/**
 * The tenant's settings for customer uploads.
 */
const customerUploadSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    formats: {
      type: [{ type: String, enum: CUSTOMER_UPLOAD_FORMATS }],
      default: () => [...CUSTOMER_UPLOAD_FORMATS],
    },
    // Days after the end of the booking; may only be shortened.
    retentionDays: {
      type: Number,
      default: MAX_RETENTION_DAYS,
      min: 0,
      max: MAX_RETENTION_DAYS,
    },
    // To the booker, before the upload deadline of a missing required upload.
    reminderDaysBeforeDeadline: { type: Number, default: 3, min: 0 },
    // To the staff, before the automatic deletion of an unchecked upload.
    reviewReminderDaysBeforeDeletion: {
      type: Number,
      default: 3,
      min: 0,
      max: MAX_RETENTION_DAYS,
    },
    // Independent of `notifyOnNewBooking`.
    notifyOnSubmitted: { type: Boolean, default: true },
    notifyOnOverdue: { type: Boolean, default: true },
    // The roles whose active members get „Nachweis eingereicht“ and
    // „Nachweis überfällig“; never the tenant's
    // address. None: nobody gets them.
    notifyRoleIds: { type: [String], default: [] },
  },
  { _id: false },
);

module.exports = { uploadFieldDefinitionSchema, customerUploadSettingsSchema };
