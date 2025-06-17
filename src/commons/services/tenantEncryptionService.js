const SecurityUtils = require("../utilities/security-utils");
const PaymentApplication = require("../entities/application/paymentApplication");
const AuthApplication = require("../entities/application/authApplication");
const LockerApplication = require("../entities/application/lockerApplication");

class TenantEncryptionService {
  /**
   *
   */
  static encryptInPlace(tenantData) {
    if (!tenantData) return;

    if (tenantData.noreplyPassword) {
      tenantData.noreplyPassword = SecurityUtils.encrypt(
        tenantData.noreplyPassword,
      );
    }

    if (tenantData.noreplyGraphClientSecret) {
      tenantData.noreplyGraphClientSecret = SecurityUtils.encrypt(
        tenantData.noreplyGraphClientSecret,
      );
    }

    if (tenantData.applications) {
      tenantData.applications = this.encryptApplications(
        tenantData.applications,
      );
    }
  }

  /**
   *
   */
  static decryptInPlace(tenantData) {
    if (!tenantData) return;

    if (tenantData.noreplyPassword) {
      tenantData.noreplyPassword = SecurityUtils.decrypt(
        tenantData.noreplyPassword,
      );
    }

    if (tenantData.noreplyGraphClientSecret) {
      tenantData.noreplyGraphClientSecret = SecurityUtils.decrypt(
        tenantData.noreplyGraphClientSecret,
      );
    }

    if (tenantData.applications) {
      tenantData.applications = this.decryptApplications(
        tenantData.applications,
      );
    }
  }

  static encryptApplications(applications) {
    return applications?.map((app) => {
      const appInstance = this.createApplicationInstance(app);
      appInstance.encrypt();
      return appInstance;
    });
  }

  static decryptApplications(applications) {
    return applications?.map((app) => {
      const appInstance = this.createApplicationInstance(app);
      appInstance.decrypt();
      return appInstance;
    });
  }

  static createApplicationInstance(app) {
    const applicationTypes = {
      payment: PaymentApplication,
      auth: AuthApplication,
      locker: LockerApplication,
    };

    const ApplicationClass = applicationTypes[app.type];
    if (!ApplicationClass) {
      throw new Error(`Unknown application type: ${app.type}`);
    }

    return new ApplicationClass(app);
  }
}

module.exports = TenantEncryptionService;
