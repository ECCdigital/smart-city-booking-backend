const PmPaymentApplication = require("./pmPaymentApplication");

class GiroCockpitApplication extends PmPaymentApplication {
  constructor(params) {
    super({
      id: "giroCockpit",
      title: "S-Public Services",
      ...params,
    });
    this.paymentPurposeSuffix = params.paymentPurposeSuffix || "";
  }

  static get Schema() {
    return {
      ...super.Schema,
      paymentPurposeSuffix: { type: String, default: "" },
    };
  }
}

module.exports = GiroCockpitApplication;