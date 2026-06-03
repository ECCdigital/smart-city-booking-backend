const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

class AccessApplication extends TenantApplication {
  constructor(params) {
    super({ type: "access", ...params });
    this.apiBaseUrl = params.apiBaseUrl || "";
  }

  decrypt() {}

  encrypt() {}

  static get Schema() {
    return {
      ...super.Schema,
      apiBaseUrl: { type: String, default: "" },
    };
  }
}

class NukiAccessApplication extends AccessApplication {
  constructor(params) {
    super(params);
    this.apiToken = params.apiToken || null;
    this.apiBaseUrl = params.apiBaseUrl || "https://api.nuki.io";
  }

  decrypt() {
    if (this.apiToken) {
      this.apiToken = SecurityUtils.decrypt(this.apiToken);
    }
  }

  encrypt() {
    if (this.apiToken) {
      this.apiToken = SecurityUtils.encrypt(this.apiToken);
    }
  }

  static get Schema() {
    return {
      ...super.Schema,
      apiToken: { type: Object, default: null },
      apiBaseUrl: { type: String, default: "https://api.nuki.io" },
    };
  }
}

const accessAppTypes = {
  nuki: NukiAccessApplication,
};

function createAccessApplication(params) {
  const AppClass = accessAppTypes[params.id] || AccessApplication;
  return new AppClass(params);
}

function registerAccessAppType(id, AppClass) {
  accessAppTypes[id] = AppClass;
}

module.exports = {
  AccessApplication,
  NukiAccessApplication,
  accessAppTypes,
  createAccessApplication,
  registerAccessAppType,
};
