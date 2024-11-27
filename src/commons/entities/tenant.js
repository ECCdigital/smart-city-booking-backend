class Tenant {
  constructor(
    id,
    name,
    contactName,
    location,
    mail,
    phone,
    applications = [],
    enablePublicStatusView,
  ) {
    this.id = id;
    this.name = name;
    this.contactName = contactName;
    this.location = location;
    this.mail = mail;
    this.phone = phone;
    this.applications = applications;
    this.enablePublicStatusView = enablePublicStatusView;
  }
}

module.exports = Tenant;
