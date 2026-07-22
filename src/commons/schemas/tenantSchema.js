const { customFieldDefinitionSchema } = require("./customFieldDefinition");
const { Schema } = require("mongoose");
const {
  getCancellationRefundTiersError,
} = require("../utilities/cancellation-refund-tiers");

const cancellationRefundTierSchema = new Schema(
  {
    daysBeforeStart: { type: Number, required: true, min: 0 },
    refundPercentage: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const tenantSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  contactName: { type: String, default: "" },
  location: { type: String, default: "" },
  mail: { type: String, default: "" },
  phone: { type: String, default: "" },
  website: { type: String, default: "" },
  platform: { type: String, default: "" },
  bookableDetailLink: { type: String, default: "" },
  eventDetailLink: { type: String, default: "" },
  genericMailTemplate: { type: String, default: "" },
  mailSnippets: { type: Object, default: {} },
  mailSubjects: { type: Object, default: {} },
  useInstanceMail: { type: Boolean, default: true },
  noreplyMail: { type: String, default: "" },
  noreplyDisplayName: { type: String, default: "" },
  noreplyHost: { type: String, default: "" },
  noreplyPort: { type: Number, default: "" },
  noreplyUser: { type: String, default: "" },
  noreplyPassword: { type: Object, default: null },
  noreplyStarttls: { type: Boolean, default: false },
  noreplyUseGraphApi: { type: Boolean, default: false },
  noreplyGraphTenantId: { type: String, default: "" },
  noreplyGraphClientId: { type: String, default: "" },
  noreplyGraphClientSecret: { type: Object, default: null },
  receiptTemplate: { type: String, default: "" },
  receiptNumberPrefix: { type: String, default: "" },
  receiptCount: { type: Object, default: {} },
  receiptEnableBCC: { type: Boolean, default: false },
  invoiceTemplate: { type: String, default: "" },
  invoiceNumberPrefix: { type: String, default: "" },
  invoiceCount: { type: Object, default: {} },
  cancellationCount: { type: Object, default: {} },
  cancellationTemplate: { type: String, default: "" },
  cancellationNumberPrefix: { type: String, default: "" },
  cancellationRefundTiers: {
    type: [cancellationRefundTierSchema],
    default: [],
    validate: (tiers) => !getCancellationRefundTiersError(tiers),
  },
  pdfBookingLayout: {
    type: String,
    enum: ["summary", "compact", "detailed"],
    default: "detailed",
  },
  pdfBookingTableMeta: {
    type: Object,
    default: () => ({
      showBookingId: true,
      showBookingPeriod: true,
      showPaymentDate: true,
      showPaymentMethod: true,
    }),
  },
  paymentPurposeSuffix: { type: String, default: "" },
  applications: { type: Array, default: [] },
  maxBookingAdvanceInMonths: { type: Number, default: null },
  defaultEventCreationMode: { type: String, default: "" },
  enablePublicStatusView: { type: Boolean, default: false },
  notifyOnNewBooking: { type: Boolean, default: true },
  notifySupervisorsOnBooking: { type: Boolean, default: false },
  catalogParticipation: {
    type: Object,
    default: {
      visible: true,
      restricted: false,
    },
  },

  bookableCustomFields: {
    type: [customFieldDefinitionSchema],
    default: [],
  },
};

module.exports = tenantSchemaDefinition;
