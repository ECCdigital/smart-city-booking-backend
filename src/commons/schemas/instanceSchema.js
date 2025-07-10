const fs = require("fs");
const path = require("path");
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
  dataProtectionUrl: { type: String, default: "" },
  legalNoticeUrl: { type: String, default: "" },
  allowAllUsersToCreateTenant: { type: Boolean, default: false },
  allowedUsersToCreateTenant: { type: Array, ref: "User", default: [] },
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
    }
  },
};

module.exports = {
  instanceSchemaDefinition,
};
