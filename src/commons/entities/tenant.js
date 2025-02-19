class Tenant {
  constructor({
    id,
    name,
    contactName,
    location,
    mail,
    phone,
    website,
    bookableDetailLink,
    eventDetailLink,
    genericMailTemplate,
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
    receiptTemplate,
    receiptNumberPrefix,
    receiptCount,
    invoiceTemplate,
    invoiceNumberPrefix,
    invoiceCount,
    paymentPurposeSuffix,
    applications,
    maxBookingAdvanceInMonths,
    defaultEventCreationMode,
    enablePublicStatusView,
    ownerUserIds,
    users,
  }) {
    this.id = id;
    this.name = name;
    this.contactName = contactName;
    this.location = location;
    this.mail = mail;
    this.phone = phone;
    this.website = website;
    this.bookableDetailLink = bookableDetailLink;
    this.eventDetailLink = eventDetailLink;
    this.genericMailTemplate = genericMailTemplate;
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
    this.receiptTemplate = receiptTemplate;
    this.receiptNumberPrefix = receiptNumberPrefix;
    this.receiptCount = receiptCount;
    this.invoiceTemplate = invoiceTemplate;
    this.invoiceNumberPrefix = invoiceNumberPrefix;
    this.invoiceCount = invoiceCount;
    this.paymentPurposeSuffix = paymentPurposeSuffix;
    this.applications = applications || [];
    this.maxBookingAdvanceInMonths = maxBookingAdvanceInMonths;
    this.defaultEventCreationMode = defaultEventCreationMode || "";
    this.enablePublicStatusView = enablePublicStatusView;
    this.ownerUserIds = ownerUserIds;
    this.users = users || [];
  }

  removePrivateData() {
    delete this.genericMailTemplate;
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
    delete this.receiptTemplate;
    delete this.receiptNumberPrefix;
    delete this.receiptCount;
    delete this.invoiceTemplate;
    delete this.invoiceNumberPrefix;
    delete this.invoiceCount;
    delete this.paymentPurposeSuffix;
    delete this.applications;
    delete this.maxBookingAdvanceInMonths;
    delete this.ownerUserIds;
    delete this.users;
  }

  static schema() {
    return {
      id: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      contactName: { type: String, default: "" },
      location: { type: String, default: "" },
      mail: { type: String, default: "" },
      phone: { type: String, default: "" },
      website: { type: String, default: "" },
      bookableDetailLink: { type: String, default: "" },
      eventDetailLink: { type: String, default: "" },
      genericMailTemplate: { type: String, default: "" },
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
      invoiceTemplate: { type: String, default: "" },
      invoiceNumberPrefix: { type: String, default: "" },
      invoiceCount: { type: Object, required: true },
      paymentPurposeSuffix: { type: String, default: "" },
      applications: { type: Array, default: [] },
      maxBookingAdvanceInMonths: { type: Number, default: null },
      defaultEventCreationMode: { type: String, default: "" },
      enablePublicStatusView: { type: Boolean, default: false },
      ownerUserIds: { type: Array, default: [] },
      users: [
        {
          userId: {
            type: String,
            required: true,
          },
          roles: {
            type: [
              {
                type: String,
              },
            ],
            default: [],
          },
        },
      ],
    };
  }
}

module.exports = Tenant;
