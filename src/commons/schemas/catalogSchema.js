const catalogSchemaDefinition = {
  type: { type: String, default: "single", enum: ["single", "aggregate"] },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  tenantId: { type: String, required: true, unique: true, ref: "Tenant" },
  tenantIds: [
    {
      type: Array,
      ref: "Tenant",
      required: function () {
        return this.type === "aggregate";
      },
    },
  ],
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
