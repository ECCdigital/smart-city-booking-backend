const fs = require("fs");
const path = require("path");
const { customFieldDefinitionSchema } = require("./customFieldDefinition");
const {
  SUPERVISION_LEVELS,
  INITIAL_SUPERVISION_LEVELS,
} = require("../services/supervision/supervision-constants");
const defaultMailTemplate = fs.readFileSync(
  path.join(
    __dirname,
    "../mail-service/templates/default-generic-mail-template.temp.html",
  ),
  "utf8",
);

const instanceSchemaDefinition = {
  applications: { type: Array, default: [] },
  mailTemplate: { type: String, default: defaultMailTemplate },
  mailAddress: { type: String, default: "" },
  noreplyMail: { type: String, default: "" },
  noreplyDisplayName: { type: String, default: "" },
  noreplyHost: { type: String, default: "" },
  noreplyPort: { type: Number, default: null },
  noreplyUser: { type: String, default: "" },
  noreplyPassword: { type: Object, default: null },
  noreplyStarttls: { type: Boolean, default: false },
  noreplyUseGraphApi: { type: Boolean, default: false },
  noreplyGraphTenantId: { type: String, default: "" },
  noreplyGraphClientId: { type: String, default: "" },
  noreplyGraphClientSecret: { type: Object, default: null },
  mailEnabled: { type: Boolean, default: false },
  contactAddress: { type: String, default: "" },
  contactUrl: { type: String, default: "" },
  // The Copyright-Vermerk: the rights holder alone, no year, no sign — the
  // rendering surface adds both. `""` means none is set. The validator runs
  // before the empty check and returns SchemaUtils code-map keys, so `""`
  // and an absent field pass while `null` is refused as a type error.
  copyright: {
    type: String,
    default: "",
    validate: (value) => {
      if (value === undefined || value === "") return true;
      if (typeof value !== "string") return "type_string";
      if (value.length > 200) return "maxLength";
      if (/[\r\n]/.test(value)) return "format";
      return true;
    },
  },
  // The legal documents carry a media reference in `reference` (§4.9); the
  // legacy `{ source, url, fileName }` form stays as the derived read field
  // until the vue-app picks media itself. They stay untyped objects for the
  // same reason the event reference sites do: a subdocument type would cast
  // legacy stock on `init` and make it unreadable.
  dataProtection: {
    type: Object,
    default: () => ({ source: "url", url: "", fileName: "", reference: null }),
  },
  legalNotice: {
    type: Object,
    default: () => ({ source: "url", url: "", fileName: "", reference: null }),
  },
  termsAndConditions: {
    type: Object,
    default: () => ({ source: "url", url: "", fileName: "", reference: null }),
  },
  allowAllUsersToCreateTenant: { type: Boolean, default: false },
  allowedUsersToCreateTenant: { type: Array, ref: "User", default: [] },
  // The Startstufe (glossary): the supervision level a self-created tenant
  // starts at - one of the initial levels, never `declined`. Read
  // server-side on creation and never retroactive; a missing value reads
  // as `free`.
  tenantInitialSupervisionLevel: {
    type: String,
    enum: INITIAL_SUPERVISION_LEVELS,
    default: SUPERVISION_LEVELS.FREE,
  },
  ownerUserIds: { type: Array, ref: "User", default: [] },
  isInitialized: { type: Boolean, default: false },
  userNotifications: {
    type: Array,
    default: [],
    schema: {
      id: { type: String, default: null },
      enabled: { type: Boolean, default: true },
      message: { type: String },
      tenants: { type: Array, default: [] },
      path: { type: Array, default: [] },
    },
  },
  checkout: {
    type: Object,
    default: {
      useLegacyCheckout: true,
      checkoutUrl: "",
    },
  },
  publicOffersEnabled: { type: Boolean, default: false },
  portalUrl: { type: String, default: "" },
  // `logo` and `favicon` hold the media references (§4.9); `logoUrl` and
  // `faviconUrl` stay the derived read fields the frontends use.
  branding: {
    type: Object,
    default: () => ({
      active: false,
      theme: {
        colors: { primary: "", secondary: "" },
      },
      logo: null,
      favicon: null,
      logoUrl: "",
      faviconUrl: "",
    }),
  },

  bookableCustomFields: {
    type: [customFieldDefinitionSchema],
    default: [],
  },
};

module.exports = {
  instanceSchemaDefinition,
};
