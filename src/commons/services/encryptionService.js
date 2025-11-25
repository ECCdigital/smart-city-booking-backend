const SecurityUtils = require("../utilities/security-utils");
const PaymentApplication = require("../entities/application/paymentApplication");
const AuthApplication = require("../entities/application/authApplication");
const LockerApplication = require("../entities/application/lockerApplication");
const KeycloakSsoApplication = require("../entities/application/keycloakSsoApplication");

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

  static encryptApplications(applications, applicationTypesMap) {
    if (!applications) return applications;
    return applications.map((app) => {
      const appInstance = this.createApplicationInstance(app, applicationTypesMap);
      appInstance.encrypt();
      return appInstance;
    });
  }

  static decryptApplications(applications, applicationTypesMap) {
    if (!applications) return applications;
    return applications.map((app) => {
      const appInstance = this.createApplicationInstance(app, applicationTypesMap);
      appInstance.decrypt();
      return appInstance;
    });
  }

  static createApplicationInstance(app, applicationTypesMap) {
    const ApplicationClass = applicationTypesMap[app.type];
    if (!ApplicationClass) {
      throw new Error(`Unknown application type: ${app.type}`);
    }
    return new ApplicationClass(app);
  }
}

class InstanceEncryptionService extends EncryptionService {
  static encrypt(data) {
    if (!data) return;

    this.encryptFields(data, [
      "noreplyPassword",
      "noreplyGraphClientSecret",
    ]);

    if (data.applications) {
      data.applications = this.encryptApplications(data.applications);
    }

  }
  static decrypt(data) {
    if (!data) return;

    this.decryptFields(data, [
      "noreplyPassword",
      "noreplyGraphClientSecret",
    ]);


    if (data.applications) {
      data.applications = this.decryptApplications(data.applications);
    }
  }
  static encryptApplications(applications) {
    const applicationTypes = {
      auth: KeycloakSsoApplication,
    };
    return super.encryptApplications(applications, applicationTypes);
  }

  static decryptApplications(applications) {
    const applicationTypes = {
      auth: KeycloakSsoApplication,
    };
    return super.decryptApplications(applications, applicationTypes);
  }
}

class TenantEncryptionService extends EncryptionService {
  static encrypt(data) {
    if (!data) return;

    this.encryptFields(data, [
      "noreplyPassword",
      "noreplyGraphClientSecret",
    ]);

    if (data.applications) {
      data.applications = this.encryptApplications(data.applications);
    }
  }

  static decrypt(data) {
    if (!data) return;

    this.decryptFields(data, [
      "noreplyPassword",
      "noreplyGraphClientSecret",
    ]);


    if (data.applications) {
      data.applications = this.decryptApplications(data.applications);
    }
  }

  static encryptApplications(applications) {
    const applicationTypes = {
      payment: PaymentApplication,
      auth: AuthApplication,
      locker: LockerApplication,
    };
    return super.encryptApplications(applications, applicationTypes);
  }

  static decryptApplications(applications) {
    const applicationTypes = {
      payment: PaymentApplication,
      auth: AuthApplication,
      locker: LockerApplication,
    };
    return super.decryptApplications(applications, applicationTypes);
  }
}

module.exports = {
  InstanceEncryptionService,
  TenantEncryptionService,
};
