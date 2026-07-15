const { Double } = require("mongodb");
const { Schema } = require("mongoose");

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
  isCommitted: { type: Boolean, default: false },
  isPayed: { type: Boolean, default: false },
  isRejected: { type: Boolean, default: false },
  location: { type: String, default: "" },
  lockerInfo: { type: [Object], default: [] },
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
};

module.exports = {
  bookingSchemaDefinition,
  bookingHookSchemaDefinition,
};
