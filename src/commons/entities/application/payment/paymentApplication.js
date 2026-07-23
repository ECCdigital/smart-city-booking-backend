const TenantApplication = require("../tenantApplication");

class PaymentApplication extends TenantApplication {
  constructor(params) {
    super({ type: "payment", ...params });
  }

  static get Schema() {
    return {
      ...super.Schema,
    };
  }
}

module.exports = PaymentApplication;
