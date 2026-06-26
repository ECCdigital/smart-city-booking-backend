const PaymentService = require("./payment-service");
const { getBooking } = require("../../../data-managers/booking-manager");
const { getTenantApp } = require("../../../data-managers/tenant-manager");
const BookingManager = require("../../../data-managers/booking-manager");
const MailController = require("../../../mail-service/mail-controller");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "pm-payment-service",
  level: process.env.LOG_LEVEL,
});

const PM_CHECKOUT_URL_PROD = "https://www.payment.govconnect.de/payment/secure";

const PM_CHECKOUT_URL_TEST =
  "https://payment-test.govconnect.de/payment/secure";

const PM_STATUS_URL_PROD = "https://www.payment.govconnect.de/payment/status";

const PM_STATUS_URL_TEST = "https://payment-test.govconnect.de/payment/status";

class PmPaymentService extends PaymentService {
  static PM_SUCCESS_CODE = 1;

  async createPayment() {
    if (this.aggregated) {
      return this.aggregatedPaymentUrl();
    } else {
      return this.createSeparatePaymentUrl();
    }
  }

  async createSeparatePaymentUrl() {
    const paymentUrls = [];
    for (const bookingId of this.bookingIds) {
      const booking = await getBooking(bookingId, this.tenantId);
      const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
      let PM_CHECKOUT_URL;
      if (paymentApp.paymentMode === "prod") {
        PM_CHECKOUT_URL = PM_CHECKOUT_URL_PROD;
      } else {
        PM_CHECKOUT_URL = PM_CHECKOUT_URL_TEST;
      }

      const amount = Math.round(booking.priceEur * 100 || 0).toString();
      const desc = `${bookingId} ${paymentApp.paymentPurposeSuffix || ""}`;
      const AGS = paymentApp.paymentMerchantId;
      const PROCEDURE = paymentApp.paymentProjectId;
      const PAYMENT_SALT = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${bookingId}`;
      const redirectUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${bookingId}&tenant=${this.tenantId}&paymentMethod=${paymentApp.id}`;

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
          `Payment URL requested for booking ${bookingId}: ${response.data?.url}`,
        );
        paymentUrls.push({ bookingId, url: response.data?.url });
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }
    }
    return paymentUrls;
  }

  async aggregatedPaymentUrl() {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      this.bookingIds,
    );

    const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
    let PM_CHECKOUT_URL;
    if (paymentApp.paymentMode === "prod") {
      PM_CHECKOUT_URL = PM_CHECKOUT_URL_PROD;
    } else {
      PM_CHECKOUT_URL = PM_CHECKOUT_URL_TEST;
    }

    const amount = Math.round(
      bookings.reduce((acc, booking) => acc + booking.priceEur * 100, 0),
    );

    const desc = this.groupBookingId
      ? `${this.groupBookingId} ${paymentApp.paymentPurposeSuffix || ""}`
      : `${this.bookingIds.join(",")} ${paymentApp.paymentPurposeSuffix || ""}`;
    const AGS = paymentApp.paymentMerchantId;
    const PROCEDURE = paymentApp.paymentProjectId;
    const PAYMENT_SALT = paymentApp.paymentSecret;

    const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${this.bookingIds.join(",")}&aggregated=true`;
    const redirectUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${this.bookingIds.join(",")}&tenant=${this.tenantId}&paymentMethod=${paymentApp.id}&aggregated=true`;

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
        `Payment URL requested for booking ${this.bookingIds}: ${response.data?.url}`,
      );
      return [{ bookingIds: this.bookingIds, url: response.data?.url }];
    } else {
      logger.warn("could not get payment url.", response.data);
      throw new Error("could not get payment url.");
    }
  }

  async paymentRequest() {
    if (this.aggregated) {
      return this.aggregatedPaymentLink();
    } else {
      return this.separatePaymentLink();
    }
  }

  async separatePaymentLink() {
    try {
      for (const bookingId of this.bookingIds) {
        const booking = await BookingManager.getBooking(
          bookingId,
          this.tenantId,
        );

        await MailController.sendPaymentLinkAfterBookingApproval(
          booking.mail,
          bookingId,
          this.tenantId,
        );
      }
    } catch (error) {
      throw error;
    }
  }

  async aggregatedPaymentLink() {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      this.bookingIds,
    );

    await MailController.sendPaymentLinkAfterBookingApproval(
      bookings[0].mail,
      this.bookingIds,
      this.tenantId,
      true,
    );
  }

  async paymentNotification(body) {
    const { ags, txid, payment_method: paymentProvider } = body;

    try {
      if (!this.bookingIds || !this.tenantId) {
        logger.warn(
          `${this.tenantId} -- could not validate payment notification. Missing parameters. For Bookings ${this.bookingIds}`,
        );
        throw new Error("Missing parameters");
      }

      const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
      let PM_STATUS_URL;
      if (paymentApp.paymentMode === "prod") {
        PM_STATUS_URL = PM_STATUS_URL_PROD;
      } else {
        PM_STATUS_URL = PM_STATUS_URL_TEST;
      }

      const config = {
        method: "get",
        url: `${PM_STATUS_URL}/${ags}/${txid}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      };

      const response = await axios(config);

      const paymentStatus = Number(response.data?.status);

      if (paymentStatus === PmPaymentService.PM_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- pmPayment responds with status ${PmPaymentService.PM_SUCCESS_CODE} / successfully payed for bookings ${this.bookingIds} .`,
        );

        const paymentMapping = {
          giropay: "GIROPAY",
          sepa: "TRANSFER",
          creditcard: "CREDIT_CARD",
          paypal: "PAYPAL",
          applepay: "APPLE_PAY",
          googlepay: "GOOGLE_PAY",
        };

        await this.handleSuccessfulPayment({
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod:
            paymentMapping[String(paymentProvider || "").toLowerCase()] ||
            "OTHER",
        });

        logger.info(
          `${this.tenantId} -- bookings ${this.bookingIds} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- bookings ${this.bookingIds} could not be payed. pmPayment status response: ${JSON.stringify(response.data)}`,
        );
        return false;
      }
    } catch (error) {
      logger.error(
        `${this.tenantId} -- payment notification error. For Bookings ${this.bookingIds}`,
      );
      throw error;
    }
  }

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    await super.handleSuccessfulPayment({
      bookingIds,
      tenantId,
      paymentMethod,
    });
  }

  async testConnection() {
    return { success: false, message: "" };
  }
}

module.exports = PmPaymentService;
