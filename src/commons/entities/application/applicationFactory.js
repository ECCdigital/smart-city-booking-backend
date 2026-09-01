const EPayBLApplication = require("./payment/ePayBLApplication");
const PmPaymentApplication = require("./payment/pmPaymentApplication");
const GiroCockpitApplication = require("./payment/giroCockpitApplication");
const InvoiceApplication = require("./payment/invoiceApplication");
const AuthApplication = require("./authApplication");
const { createLockerApplication } = require("./lockerApplication");
const { createAccessApplication } = require("./accessApplication");
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
  static create(data) {
    if (data.type === "payment") {
      const PaymentClass = PAYMENT_CLASS_MAP[data.id];
      if (!PaymentClass) {
        throw new Error(`Unknown payment application id: ${data.id}`);
      }
      return new PaymentClass(data);
    }

    if (data.type === "locker") {
      return createLockerApplication(data);
    }

    if (data.type === "access") {
      return createAccessApplication(data);
    }

    const ApplicationClass = TYPE_CLASS_MAP[data.type];
    if (!ApplicationClass) {
      throw new Error(`Unknown application type: ${data.type}`);
    }
    return new ApplicationClass(data);
  }

  static createAll(dataArray) {
    return dataArray.map((data) => ApplicationFactory.create(data));
  }
}

module.exports = ApplicationFactory;
