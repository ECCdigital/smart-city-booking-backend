const { getBooking } = require("../../data-managers/booking-manager");
const { getTenantApp } = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const BookingManager = require("../../data-managers/booking-manager");
const ReceiptService = require("./receipt-service");
const TenantManager = require("../../data-managers/tenant-manager");
const InvoiceService = require("./invoice-service");

const logger = bunyan.createLogger({
  name: "payment-service.js",
  level: process.env.LOG_LEVEL,
});

class PaymentService {
  constructor(tenantId, bookingId) {
    this.tenantId = tenantId;
    this.bookingId = bookingId;
  }

  createPayment() {
    throw new Error("createPayment not implemented");
  }

  paymentNotification() {
    throw new Error("paymentNotification not implemented");
  }

  paymentResponse() {
    throw new Error("paymentResponse not implemented");
  }

  paymentRequest() {
    throw new Error("paymentRequest not implemented");
  }

  async handleSuccessfulPayment({ bookingId, tenantId, payedWith }) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    console.log("handleSuccessfulPayment2");
    console.log({ bookingId, tenantId, payedWith });

    booking.isPayed = true;
    booking.payedWith = payedWith;
    await BookingManager.setBookingPayedStatus(booking);

    if (booking.isCommitted && booking.isPayed) {
      let attachments = [];
      if (booking.priceEur > 0) {
        const pdfData = await ReceiptService.createReceipt(tenantId, bookingId);
        attachments = [
          {
            filename: pdfData.name,
            content: pdfData.buffer,
            contentType: "application/pdf",
          },
        ];
      }

      try {
        const MailController = require("../../mail-service/mail-controller");
        await MailController.sendBookingConfirmation(
          booking.mail,
          booking.id,
          tenantId,
          attachments,
        );

        const tenant = await TenantManager.getTenant(tenantId);
        await MailController.sendIncomingBooking(
          tenant.mail,
          bookingId,
          tenantId,
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return booking;
  }
}

class GiroCockpitPaymentService extends PaymentService {
  static GIRO_SUCCESS_CODE = "4000";

  async createPayment() {
    const booking = await getBooking(this.bookingId, this.tenantId);
    const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");

    try {
      const GIRO_CHECKOUT_URL =
        "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
      const type = "SALE";
      const test = 1;
      const currency = "EUR";

      const merchantTxId = this.bookingId;
      const amount = (booking.priceEur * 100 || 0).toString();
      const purpose = `${this.bookingId} ${
        paymentApp.paymentPurposeSuffix || ""
      }`;

      const MERCHANT_ID = paymentApp.paymentMerchantId;
      const PROJECT_ID = paymentApp.paymentProjectId;
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?id=${this.bookingId}`;
      const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}`;
      const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}`;
      const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}`;
      const hash = crypto
        .createHmac("md5", PROJECT_SECRET)
        .update(
          `${MERCHANT_ID}${PROJECT_ID}${merchantTxId}${amount}${currency}${purpose}${type}${test}${successUrl}${backUrl}${failUrl}${notifyUrl}`,
        )
        .digest("hex");

      const data = qs.stringify({
        merchantId: MERCHANT_ID,
        projectId: PROJECT_ID,
        merchantTxId: merchantTxId,
        amount: amount,
        currency: currency,
        purpose: purpose,
        type: type,
        test: test,
        successUrl: successUrl,
        backUrl: backUrl,
        failUrl: failUrl,
        notifyUrl: notifyUrl,
        hash: hash,
      });

      const config = {
        method: "post",
        url: GIRO_CHECKOUT_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };

      const response = await axios(config);

      if (response.data?.url) {
        logger.info(
          `Payment URL requested for booking ${merchantTxId}: ${response.data?.url}`,
        );
        return response.data?.url;
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }
    } catch (error) {
      throw error;
    }
  }

  async paymentNotification(query) {
    const {
      gcMerchantTxId,
      gcResultPayment,
      gcPaymethod,
      gcType,
      gcProjectId,
      gcReference,
      gcBackendTxId,
      gcAmount,
      gcCurrency,
      gcHash,
    } = query;

    try {
      if (!this.bookingId || !this.tenantId) {
        logger.warn(
          `${this.tenantId} -- could not validate payment notification. Missing parameters. For Booking ${this.bookingId}`,
        );
        throw new Error("Missing parameters");
      }
      const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const hashString =
        gcPaymethod +
        gcType +
        gcProjectId +
        gcReference +
        gcMerchantTxId +
        gcBackendTxId +
        gcAmount +
        gcCurrency +
        gcResultPayment;

      const hash = crypto
        .createHmac("md5", PROJECT_SECRET)
        .update(hashString)
        .digest("hex");

      if (gcHash !== hash) {
        logger.warn(
          `${this.tenantId} -- payment notification hash mismatch. For Booking ${this.bookingId}`,
        );
        throw new Error("Hash mismatch");
      }

      if (gcResultPayment === GiroCockpitPaymentService.GIRO_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- GiroCockpit responds with status ${GiroCockpitPaymentService.GIRO_SUCCESS_CODE} / successfully payed for booking ${this.bookingId} .`,
        );

        await this.handleSuccessfulPayment({
          bookingId: this.bookingId,
          tenantId: this.tenantId,
          payedWith: gcPaymethod,
        });

        logger.info(
          `${this.tenantId} -- booking ${this.bookingId} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- booking ${this.bookingId} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      throw error;
    }
  }

  paymentResponse() {
    return `${process.env.FRONTEND_URL}/checkout/status?id=${this.bookingId}&tenant=${this.tenantId}`;
  }

  async paymentRequest() {
    const MailController = () => require("../../mail-service/mail-controller");
    const booking = await BookingManager.getBooking(
      this.bookingId,
      this.tenantId,
    );

    await MailController().sendPaymentLinkAfterBookingApproval(
      booking.mail,
      this.bookingId,
      this.tenantId,
    );
  }

  async handleSuccessfulPayment({ bookingId, tenantId, payedWith }) {
    await super.handleSuccessfulPayment({ bookingId, tenantId, payedWith });
  }
}

class PmPaymentService extends PaymentService {
  static PM_SUCCESS_CODE = 1;

  async createPayment() {
    const booking = await getBooking(this.bookingId, this.tenantId);
    const paymentApp = await getTenantApp(this.tenantId, "pmPayment");

    try {
      let PM_CHECKOUT_URL;
      if (paymentApp.paymentMode === "prod") {
        PM_CHECKOUT_URL = "https://payment.govconnect.de/payment/secure";
      } else {
        PM_CHECKOUT_URL = "https://payment-test.govconnect.de/payment/secure";
      }

      const amount = (booking.priceEur * 100 || 0).toString();
      const desc = `${this.bookingId} ${paymentApp.paymentPurposeSuffix || ""}`;
      const AGS = paymentApp.paymentMerchantId;
      const PROCEDURE = paymentApp.paymentProjectId;
      const PAYMENT_SALT = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?id=${this.bookingId}`;
      const redirectUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${this.bookingId}&tenant=${this.tenantId}&paymentMethod=${paymentApp.id}`;

      const hash = crypto
        .createHmac("sha256", PAYMENT_SALT)
        .update(
          `${AGS}|${amount}|${PROCEDURE}|${desc}|${notifyUrl}|${redirectUrl}`,
        )
        .digest("hex");

      const data = qs.stringify({
        ags: AGS,
        amount: amount,
        procedure: PROCEDURE,
        desc: desc,
        notifyURL: notifyUrl,
        redirectURL: redirectUrl,
        hash: hash,
      });

      const config = {
        method: "post",
        url: PM_CHECKOUT_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };

      const response = await axios(config);

      if (response.data?.url) {
        logger.info(
          `Payment URL requested for booking ${this.bookingId}: ${response.data?.url}`,
        );
        return response.data?.url;
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }
    } catch (error) {
      throw error;
    }
  }

  paymentResponse() {
    return `${process.env.FRONTEND_URL}/checkout/status?id=${this.bookingId}&tenant=${this.tenantId}`;
  }

  async paymentRequest() {
    const MailController = () => require("../../mail-service/mail-controller");
    const booking = await BookingManager.getBooking(
      this.bookingId,
      this.tenantId,
    );

    await MailController().sendPaymentLinkAfterBookingApproval(
      booking.mail,
      this.bookingId,
      this.tenantId,
    );
  }

  async paymentNotification(body) {
    const { ags, txid, payment_method: paymentMethod } = body;

    try {
      if (!this.bookingId || !this.tenantId) {
        logger.warn(
          `${this.tenantId} -- could not validate payment notification. Missing parameters. For Booking ${this.bookingId}`,
        );
        throw new Error("Missing parameters");
      }

      const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
      let PM_STATUS_URL;
      if (paymentApp.paymentMode === "prod") {
        PM_STATUS_URL = "https://payment.govconnect.de/payment/status";
      } else {
        PM_STATUS_URL = "https://payment-test.govconnect.de/payment/status";
      }

      const config = {
        method: "get",
        url: `${PM_STATUS_URL}/${ags}/${txid}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      };

      const response = await axios(config);

      if (response.data.status === PmPaymentService.PM_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- pmPayment responds with status ${PmPaymentService.PM_SUCCESS_CODE} / successfully payed for booking ${this.bookingId} .`,
        );

        const paymentMapping = {
          giropay: "GIROPAY",
          sepa: "TRANSFER",
          creditCard: "CREDIT_CARD",
          paypal: "PAYPAL",
          applePay: "APPLE_PAY",
          googlePay: "GOOGLE_PAY",
        };

        await this.handleSuccessfulPayment({
          bookingId: this.bookingId,
          tenantId: this.tenantId,
          payedWith: paymentMapping[paymentMethod] || "OTHER",
        });

        logger.info(
          `${this.tenantId} -- booking ${this.bookingId} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- booking ${this.bookingId} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      logger.error(
        `${this.tenantId} -- payment notification error. For Booking ${this.bookingId}`,
      );
      throw error;
    }
  }

  async handleSuccessfulPayment({ bookingId, tenantId, payMethod }) {
    console.log("handleSuccessfulPayment");
    console.log({ bookingId, tenantId, payMethod });
    await super.handleSuccessfulPayment({ bookingId, tenantId, payMethod });
  }
}

class InvoicePaymentService extends PaymentService {
  constructor(tenantId, bookingId) {
    super(tenantId, bookingId);
  }
  async createPayment() {
    const MailController = () => require("../../mail-service/mail-controller");
    const booking = await getBooking(this.bookingId, this.tenantId);

    let attachments = [];
    try {
      const pdfData = await InvoiceService.createInvoice(
        this.tenantId,
        this.bookingId,
      );

      attachments = [
        {
          filename: pdfData.name,
          content: pdfData.buffer,
          contentType: "application/pdf",
        },
      ];
    } catch (error) {
      throw error;
    }

    try {
      await MailController().sendInvoice(
        booking.mail,
        this.bookingId,
        this.tenantId,
        attachments,
      );
    } catch (err) {
      logger.error(err);
    }

    return true;
  }
  async paymentNotification() {
    console.log("paymentNotification");
  }
  async paymentResponse() {
    console.log("paymentResponse");
  }

  async paymentRequest() {
    const MailController = () => require("../../mail-service/mail-controller");
    try {
      const booking = await BookingManager.getBooking(
        this.bookingId,
        this.tenantId,
      );
      const pdfData = await InvoiceService.createInvoice(
        this.tenantId,
        this.bookingId,
      );

      const attachments = [
        {
          filename: pdfData.name,
          content: pdfData.buffer,
          contentType: "application/pdf",
        },
      ];
      await MailController().sendInvoiceAfterBookingApproval(
        booking.mail,
        this.bookingId,
        this.tenantId,
        attachments,
      );
    } catch (error) {
      throw error;
    }
  }
}

module.exports = {
  GiroCockpitPaymentService,
  PmPaymentService,
  InvoicePaymentService,
};
