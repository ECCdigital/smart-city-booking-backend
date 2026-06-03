const TenantApplication = require("./tenantApplication");

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

const accessAppTypes = {};

function createAccessApplication(params) {
  const AppClass = accessAppTypes[params.id] || AccessApplication;
  return new AppClass(params);
}

function registerAccessAppType(id, AppClass) {
  accessAppTypes[id] = AppClass;
}

module.exports = {
  AccessApplication,
  accessAppTypes,
  createAccessApplication,
  registerAccessAppType,
};
