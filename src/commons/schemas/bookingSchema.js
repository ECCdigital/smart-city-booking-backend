const { Double } = require("mongodb");
const { Schema } = require("mongoose");
const { mediaReferenceSchema } = require("./mediaSchema");
const {
  STATUSES,
  CANCELLED_FROM_STATUSES,
} = require("../services/booking-lifecycle/booking-state");

const bookingHookSchemaDefinition = {
  id: { type: String, required: true },
  type: { type: String, required: true },
  timeCreated: { type: Double, default: () => Date.now() },
  payload: { type: Object, default: {} },
};

const customFieldValueSchema = new Schema(
  {
    fieldId: { type: String, required: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const originalCancellationDocumentSchema = new Schema(
  {
    number: { type: String, default: "" },
    timeCreated: { type: Double, default: null },
  },
  { _id: false },
);

const cancellationAuditSchema = new Schema(
  {
    cancelledAt: { type: Double, required: true },
    daysBeforeStart: { type: Number, default: null },
    originalAmountEur: { type: Number, required: true, min: 0 },
    suggestedRefundPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    appliedRefundPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    refundAmountEur: { type: Number, required: true, min: 0 },
    cancellationFeeEur: { type: Number, required: true, min: 0 },
    appliedTierDays: { type: Number, default: null, min: 0 },
    origin: {
      type: String,
      required: true,
      enum: ["user", "admin", "system"],
    },
    adminOverride: { type: Boolean, required: true },
    cancelledByUserId: { type: String, default: null },
    // The state the booking was cancelled from; `reinstate` returns to it
    // and the entity derives `isPayed` of a cancelled booking from it.
    cancelledFrom: {
      type: String,
      enum: CANCELLED_FROM_STATUSES,
      default: undefined,
    },
    originalDocumentRef: {
      type: originalCancellationDocumentSchema,
      default: undefined,
    },
  },
  { _id: false },
);

const attachmentSchemaDefinition = {
  type: {
    type: String,
    required: true,
  },
  title: { type: String },
  name: { type: String },
  bookableId: { type: String },
  // The checkout copies the reference of the bookable attachment through, so
  // the mail path can load the file from the media library instead of calling
  // the platform's own public URL (§4.8). `url` stays the legacy address.
  reference: { type: mediaReferenceSchema, default: undefined },
  url: { type: String },
  accepted: { type: Boolean },
  invoiceId: { type: String },
  receiptId: { type: String },
  cancellationId: { type: String },
  revision: { type: Number },
  timeCreated: { type: Double },
  mailAttach: { type: Boolean },
  cancellation: { type: cancellationAuditSchema, default: undefined },
};

const bookingSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },
  assignedUserId: { type: String, ref: "User", default: "" },
  attachments: {
    type: [new Schema(attachmentSchemaDefinition, { _id: false })],
    default: [],
  },
  bookableItems: {
    type: [Object],
    required: true,
    default: [],
    minItems: 1,
  },
  comment: { type: String, default: "" },
  internalComments: { type: String, default: "" },
  rejectionReason: { type: String, default: "" },
  company: { type: String, default: "" },
  couponCode: { type: String, default: "" },
  // The booking state, the one source of truth (booking-state.js). The
  // three flags below are derived from it by the entity on every write and
  // stay for the readers that query them.
  status: { type: String, enum: STATUSES, required: true },
  isCommitted: { type: Boolean, default: false },
  isPayed: { type: Boolean, default: false },
  isRejected: { type: Boolean, default: false },
  location: { type: String, default: "" },
  accessInfo: { type: [Object], default: [] },
  mail: {
    type: String,
    required: true,
    format: "multiEmail",
  },
  name: { type: String, default: "" },
  paymentProvider: {
    type: String,
    default: "",
    validate: (value, obj) => {
      if (obj.priceEur > 0 && (!value || value.trim() === "")) {
        return "required";
      }
      return true;
    },
  },
  paymentMethod: { type: String, default: "" },
  phone: { type: String, default: "" },
  priceEur: {
    type: Number,
    default: 0,
    min: 0,
  },
  street: { type: String, default: "" },
  timeBegin: { type: Double, required: false },
  timeCreated: { type: Double, default: () => Date.now() },
  timeEnd: {
    type: Double,
    required: false,
    greaterEqualThan: "timeBegin",
  },
  timePaid: { type: Double, default: 0 },
  vatIncludedEur: { type: Number, default: 0 },
  zipCode: { type: String, default: "" },
  _couponUsed: { type: Object, default: {} },
  hooks: { type: [bookingHookSchemaDefinition], default: [] },
  customFieldValues: {
    type: [customFieldValueSchema],
    default: [],
  },
  cancellationPolicy: {
    type: Object,
    default: { userCancellable: true, contactHint: "" },
  },
  cancellationRefund: { type: cancellationAuditSchema, default: undefined },
};

module.exports = {
  bookingSchemaDefinition,
  bookingHookSchemaDefinition,
  cancellationAuditSchema,
};
