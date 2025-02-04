class Instance {
  constructor({
    mailTemplate,
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
    contactAddress,
    contactUrl,
    dataProtectionUrl,
    legalNoticeUrl,
    users,
  }) {
    this.mailTemplate = mailTemplate;
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
    this.contactAddress = contactAddress;
    this.contactUrl = contactUrl;
    this.dataProtectionUrl = dataProtectionUrl;
    this.legalNoticeUrl = legalNoticeUrl;
    this.users = users;
  }

  publicInstance() {
    delete this.mailTemplate;
    delete this.noreplyMail
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
  }

  static schema() {
    return {
      mailTemplate: { type: String, required: true },
      noreplyMail: { type: String, default: "" },
      noreplyDisplayName: { type: String, default: "" },
      noreplyHost: { type: String, default: "" },
      noreplyPort: { type: Number, default: null },
      noreplyUser: { type: String, default: "" },
      noreplyPassword: { type: Object },
      noreplyStarttls: { type: Boolean, default: false },
      noreplyUseGraphApi: { type: Boolean, default: false },
      noreplyGraphTenantId: { type: String, default: "" },
      noreplyGraphClientId: { type: String, default: "" },
      noreplyGraphClientSecret: { type: Object },
      contactAddress: { type: String, default: "" },
      contactUrl: { type: String, default: "" },
      dataProtectionUrl: { type: String, default: "" },
      legalNoticeUrl: { type: String, default: "" },
      users: { type: Array, required: true, ref: "User" },
    };
  }
}

module.exports = Instance;
