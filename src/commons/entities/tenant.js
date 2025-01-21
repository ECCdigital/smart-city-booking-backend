class Tenant {
  constructor(
    {
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
      ownerUserId,
    }
  ) {
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
    this.ownerUserId = ownerUserId;
  }
}

module.exports = Tenant;
