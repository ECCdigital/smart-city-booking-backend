const fs = require("fs");
const path = require("path");
const defaultMailTemplate = fs.readFileSync(
  path.join(
    __dirname,
    "../mail-service/templates/default-generic-mail-template.temp.html",
  ),
  "utf8",
);

class Instance {
  constructor({
    mailTemplate,
    mailAddress,
    noreplyMail,
    noreplyDisplayName,
    noreplyHost,
    noreplyPort,
    noreplyUser,
    noreplyPassword,
    noreplyStarttls,
    noreplyUseGraphApi,
    noreplyGraphTenantId,
    noreplyGraphClientId,
    noreplyGraphClientSecret,
    mailEnabled,
    contactAddress,
    contactUrl,
    dataProtectionUrl,
    legalNoticeUrl,
    allowAllUsersToCreateTenant,
    allowedUsersToCreateTenant,
    ownerUserIds,
    isInitialized,
  }) {
    this.mailTemplate = mailTemplate;
    this.mailAddress = mailAddress;
    this.noreplyMail = noreplyMail;
    this.noreplyDisplayName = noreplyDisplayName;
    this.noreplyHost = noreplyHost;
    this.noreplyPort = noreplyPort;
    this.noreplyUser = noreplyUser;
    this.noreplyPassword = noreplyPassword;
    this.noreplyStarttls = noreplyStarttls;
    this.noreplyUseGraphApi = noreplyUseGraphApi || false;
    this.noreplyGraphTenantId = noreplyGraphTenantId;
    this.noreplyGraphClientId = noreplyGraphClientId;
    this.noreplyGraphClientSecret = noreplyGraphClientSecret;
    this.mailEnabled = mailEnabled;
    this.contactAddress = contactAddress;
    this.contactUrl = contactUrl;
    this.dataProtectionUrl = dataProtectionUrl;
    this.legalNoticeUrl = legalNoticeUrl;
    this.allowAllUsersToCreateTenant = allowAllUsersToCreateTenant;
    this.allowedUsersToCreateTenant = allowedUsersToCreateTenant;
    this.ownerUserIds = ownerUserIds;
    this.isInitialized = isInitialized;
  }

  removePrivateData() {
    delete this.mailTemplate;
    delete this.mailAddress;
    delete this.noreplyMail;
    delete this.noreplyDisplayName;
    delete this.noreplyHost;
    delete this.noreplyPort;
    delete this.noreplyUser;
    delete this.noreplyPassword;
    delete this.noreplyStarttls;
    delete this.noreplyUseGraphApi;
    delete this.noreplyGraphTenantId;
    delete this.noreplyGraphClientId;
    delete this.noreplyGraphClientSecret;
    delete this.ownerUserIds;
    delete this.mailEnabled;
    delete this.isInitialized;
    delete this.allowedUsersToCreateTenant;
    delete this.allowAllUsersToCreateTenant;
  }

  static get schema() {
    return {
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
    };
  }
}

module.exports = Instance;
