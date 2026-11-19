const EPayBLApplication = require("./payment/ePayBLApplication");
const PmPaymentApplication = require("./payment/pmPaymentApplication");
const GiroCockpitApplication = require("./payment/giroCockpitApplication");
const InvoiceApplication = require("./payment/invoiceApplication");
const AuthApplication = require("./authApplication");
const { AccessApplication, accessAppTypes } = require("./accessApplication");
const CardAuthApplication = require("./cardAuthApplication");

const PAYMENT_CLASS_MAP = {
  ePayBL: EPayBLApplication,
  pmPayment: PmPaymentApplication,
  giroCockpit: GiroCockpitApplication,
  invoice: InvoiceApplication,
};

const TYPE_CLASS_MAP = {
  auth: AuthApplication,
  "card-auth": CardAuthApplication,
};

class ApplicationFactory {
  /**
   * The class of an application, `null` for a type or payment id it does
   * not know. An access provider without a class of its own is an
   * `AccessApplication`, as `create` makes it.
   *
   * @param {{type: string, id: string}} data
   * @returns {Function|null}
   */
  static classOf(data) {
    if (data?.type === "payment") return PAYMENT_CLASS_MAP[data.id] || null;
    if (data?.type === "access") {
      return accessAppTypes[data.id] || AccessApplication;
    }
    return TYPE_CLASS_MAP[data?.type] || null;
  }

  static create(data) {
    const ApplicationClass = ApplicationFactory.classOf(data);
    if (!ApplicationClass) {
      throw new Error(
        data.type === "payment"
          ? `Unknown payment application id: ${data.id}`
          : `Unknown application type: ${data.type}`,
      );
    }
    return new ApplicationClass(data);
  }

  static createAll(dataArray) {
    return dataArray.map((data) => ApplicationFactory.create(data));
  }
}

module.exports = ApplicationFactory;
module.exports.PAYMENT_CLASS_MAP = PAYMENT_CLASS_MAP;
module.exports.TYPE_CLASS_MAP = TYPE_CLASS_MAP;
