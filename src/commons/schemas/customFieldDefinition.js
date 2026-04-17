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
    allowOverride: { type: Boolean, default: true },
  },
  { _id: false },
);

module.exports = { customFieldDefinitionSchema };
