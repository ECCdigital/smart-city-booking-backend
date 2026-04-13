// services/encryptionService.js
const SecurityUtils = require("../utilities/security-utils");
const ApplicationFactory = require("../entities/application/applicationFactory");

class EncryptionService {
  static encryptFields(obj, fieldNames) {
    if (!obj) return;
    for (const field of fieldNames) {
      if (!obj[field]) continue;
      obj[field] = SecurityUtils.encrypt(obj[field]);
    }
  }

  static decryptFields(obj, fieldNames) {
    if (!obj) return;
    for (const field of fieldNames) {
      if (!obj[field]) continue;
      obj[field] = SecurityUtils.decrypt(obj[field]);
    }
  }

  static encryptApplications(applications) {
    if (!applications) return applications;
    return applications.map((app) => {
      const instance = ApplicationFactory.create(app);
      instance.encrypt();
      return instance;
    });
  }

  static decryptApplications(applications) {
    if (!applications) return applications;
    return applications.map((app) => {
      const instance = ApplicationFactory.create(app);
      instance.decrypt();
      return instance;
    });
  }
}

class InstanceEncryptionService extends EncryptionService {
  static encrypt(data) {
    if (!data) return;
    this.encryptFields(data, ["noreplyPassword", "noreplyGraphClientSecret"]);
    if (data.applications) {
      data.applications = this.encryptApplications(data.applications);
    }
  }

  static decrypt(data) {
    if (!data) return;
    this.decryptFields(data, ["noreplyPassword", "noreplyGraphClientSecret"]);
    if (data.applications) {
      data.applications = this.decryptApplications(data.applications);
    }
  }
}

class TenantEncryptionService extends EncryptionService {
  static encrypt(data) {
    if (!data) return;
    this.encryptFields(data, ["noreplyPassword", "noreplyGraphClientSecret"]);
    if (data.applications) {
      data.applications = this.encryptApplications(data.applications);
    }
  }

  static decrypt(data) {
    if (!data) return;
    this.decryptFields(data, ["noreplyPassword", "noreplyGraphClientSecret"]);
    if (data.applications) {
      data.applications = this.decryptApplications(data.applications);
    }
  }
}

module.exports = {
  InstanceEncryptionService,
  TenantEncryptionService,
};
