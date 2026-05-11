const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

class LockerApplication extends TenantApplication {
  constructor(params) {
    super({ type: "locker", ...params });
    this.serverUrl = params.serverUrl || "";
  }

  decrypt() {}

  encrypt() {}

  static get Schema() {
    return {
      ...super.Schema,
      serverUrl: { type: String, default: "" },
    };
  }
}

class parevaLockerApplication extends LockerApplication {
  constructor(params) {
    super(params);
    this.version = params.version || 1;
    this.lockerId = params.lockerId || "";
    this.user = params.user || "";
    this.password = params.password || null;
  }

  decrypt() {
    if (this.password) {
      this.password = SecurityUtils.decrypt(this.password);
    }
  }

  encrypt() {
    if (this.password) {
      this.password = SecurityUtils.encrypt(this.password);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      version: { type: Number, default: 1 },
      lockerId: { type: String, default: "" },
      user: { type: String, default: "" },
      password: { type: Object, default: null },
    };
  }
}

class ifbsLockerApplication extends LockerApplication {
  constructor(params) {
    super(params);
    this.apiKeyID = params.apiKeyID || "";
    this.apiKey = params.apiKey || null;
    this.secretPhrase = params.secretPhrase || "";
    this.customerService = params.customerService || null;
  }

  decrypt() {
    if (this.apiKey) {
      this.apiKey = SecurityUtils.decrypt(this.apiKey);
      this.secretPhrase = SecurityUtils.decrypt(this.secretPhrase);
    }
  }

  encrypt() {
    if (this.apiKey) {
      this.apiKey = SecurityUtils.encrypt(this.apiKey);
      this.secretPhrase = SecurityUtils.encrypt(this.secretPhrase);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      apiKeyID: { type: String, default: "" },
      apiKey: { type: Object, default: null },
      secretPhrase: { type: Object, default: "" },
      customerService: { type: Object, default: null },
    };
  }
}

const lockerAppTypes = {
  pareva: parevaLockerApplication,
  ifbs: ifbsLockerApplication,
};

function createLockerApplication(params) {
  const AppClass = lockerAppTypes[params.id] || LockerApplication;
  return new AppClass(params);
}

function registerLockerAppType(id, AppClass) {
  lockerAppTypes[id] = AppClass;
}

module.exports = {
  LockerApplication,
  parevaLockerApplication,
  ifbsLockerApplication,
  createLockerApplication,
  registerLockerAppType,
};
