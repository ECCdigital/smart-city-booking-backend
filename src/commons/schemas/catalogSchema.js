const catalogSchemaDefinition = {
  type: { type: String, default: "single", enum: ["single", "aggregate", "instance"] },
  slug: {
    type: String,
    required: function () { return this.type !== "instance"; },
    unique: function () { return this.type !== "instance"; },
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  name: { type: String, required: function () { return this.type !== "instance"; }, maxlength: 100 },
  tenantId: { type: String, required: function () { return this.type !== "instance"; }, unique: function () { return this.type !== "instance"; }, ref: "Tenant" },
  tenantIds: [
    {
      type: Array,
      ref: "Tenant",
      required: function () {
        return this.type === "aggregate";
      },
    },
  ],
  excludedTenantIds: {
    type: [String],
    default: [],
  },
  active: {
    type: Boolean,
    default: false,
  },
  visibility: {
    type: String,
    enum: ["public", "private", "unlisted"],
    default: "public",
  },
  theme: {
    active: { type: Boolean, default: false },
    colors: {
      primary: { type: String, default: "" },
      secondary: { type: String, default: "" },
    },
  },
};

module.exports = {
  catalogSchemaDefinition,
};
