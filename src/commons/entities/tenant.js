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
      contactName: { type: String, required: true },
      location: { type: String, required: true },
      mail: { type: String, required: true },
      phone: { type: String, required: true },
      website: { type: String, required: true },
      bookableDetailLink: { type: String, required: true },
      eventDetailLink: { type: String, required: true },
      genericMailTemplate: { type: String, required: true },
      noreplyMail: { type: String, required: true },
      noreplyDisplayName: { type: String, required: true },
      noreplyHost: { type: String, required: true },
      noreplyPort: { type: Number, required: true },
      noreplyUser: { type: String, required: true },
      noreplyPassword: { type: Object, required: true },
      noreplyStarttls: { type: Boolean, required: true },
      noreplyUseGraphApi: { type: Boolean, required: true },
      noreplyGraphTenantId: { type: String, required: true },
      noreplyGraphClientId: { type: String, required: true },
      noreplyGraphClientSecret: { type: Object, required: true },
      receiptTemplate: { type: String, required: true },
      receiptNumberPrefix: { type: String, required: true },
      receiptCount: { type: Object, required: true },
      invoiceTemplate: { type: String, required: true },
      invoiceNumberPrefix: { type: String, required: true },
      invoiceCount: { type: Object, required: true },
      paymentPurposeSuffix: { type: String, required: true },
      applications: { type: Array, required: true },
      maxBookingAdvanceInMonths: { type: Number, required: true },
      defaultEventCreationMode: { type: String, required: true },
      enablePublicStatusView: { type: Boolean, required: true },
      ownerUserIds: { type: Array, required: true },
      users: [
        {
          userId: {
            type: String,
            ref: "User",
            required: true,
          },
          roles: {
            type: [
              {
                type: String,
                ref: "Role",
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
