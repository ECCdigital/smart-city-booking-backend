class Tenant {
  constructor(id, name, contactName, location, mail, phone) {
    this.id = id;
    this.name = name;
    this.contactName = contactName;
    this.location = location;
    this.mail = mail;
    this.phone = phone;
  }
}

module.exports = Tenant;
