const { Schema } = require("mongoose");

const customFieldOptionSchema = new Schema(
  {
    caption: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false },
);

const usageOptionsSchema = new Schema(
  {
    context: {
      type: String,
      enum: ["none", "checkout", "catalog"],
      default: "none",
    },

    requiredInCheckout: { type: Boolean, default: false },

    // Whether the field can be used as a catalog filter. When false, a field
    // with context "catalog" is shown as info only and catalogFilter* is ignored.
    filterable: { type: Boolean, default: false },

    catalogFilterType: {
      type: String,
      enum: [null, "select", "slider", "range", "checkbox"],
      default: null,
    },
    catalogFilterPosition: {
      type: String,
      enum: ["sidebar", "navigation", "searchbar"],
      default: "sidebar",
    },

    // Where the field is rendered in the bookable detail view.
    // "none" hides it from the detail view.
    detailDisplayPosition: {
      type: String,
      enum: ["none", "badge", "belowDescription", "moreInfo"],
      default: "none",
    },

    // Whether the value entered during checkout is shown in the booking-details
    // block of all booking mails. Only meaningful for context "checkout";
    // normalizeUsageOptions clears it otherwise.
    showInMail: { type: Boolean, default: false },
  },
  { _id: false },
);

const customFieldDefinitionSchema = new Schema(
  {
    id: { type: String, required: true },
    caption: { type: String, required: true },
    placeholder: { type: String, default: "" },
    inputType: {
      type: String,
      enum: ["string", "text", "select", "numeric", "boolean"],
      required: true,
    },
    options: {
      type: [customFieldOptionSchema],
      default: [],
    },
    usageOptions: {
      type: usageOptionsSchema,
      default: () => ({}),
    },
  },
  { _id: false },
);

module.exports = { customFieldDefinitionSchema };
