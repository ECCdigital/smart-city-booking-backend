const catalogSchemaDefinition = {
  type: {
    type: String,
    default: "single",
    enum: ["single", "aggregate", "instance"],
  },
  slug: {
    type: String,
    required: function () {
      return this.type !== "instance";
    },
    unique: function () {
      return this.type !== "instance";
    },
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  name: {
    type: String,
    required: function () {
      return this.type !== "instance";
    },
    maxlength: 100,
  },
  tenantId: {
    type: String,
    required: function () {
      return this.type !== "instance";
    },
    unique: function () {
      return this.type !== "instance";
    },
    ref: "Tenant",
  },
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
  // The Hero Layout of the Shared contract (hero-layout spec), stored
  // complete or not at all: `null` means the Default Hero Layout is derived
  // at read time. Validated in the service layer, never here - the writes
  // run `findOneAndUpdate` without `runValidators`.
  heroLayout: {
    type: Object,
    default: null,
  },
};

module.exports = {
  catalogSchemaDefinition,
};
