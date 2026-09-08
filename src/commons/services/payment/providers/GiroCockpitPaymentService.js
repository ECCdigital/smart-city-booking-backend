const PaymentService = require("./payment-service");
const { getBooking } = require("../../../data-managers/booking-manager");
const { getTenantApp } = require("../../../data-managers/tenant-manager");
const BookingManager = require("../../../data-managers/booking-manager");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "giro-cockpit-payment-service",
  level: process.env.LOG_LEVEL,
});

class GiroCockpitPaymentService extends PaymentService {
  static GIRO_SUCCESS_CODE = "4000";

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
      const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
      const GIRO_CHECKOUT_URL =
        "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
      const type = "SALE";
      const test = 1;
      const currency = "EUR";

      const merchantTxId = booking.id;
      const amount = Math.round(booking.priceEur * 100 || 0).toString();
      const purpose = `${booking.id} ${paymentApp.paymentPurposeSuffix || ""}`;

      const MERCHANT_ID = paymentApp.paymentMerchantId;
      const PROJECT_ID = paymentApp.paymentProjectId;
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${merchantTxId}&aggregated=false`;
      const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}&aggregated=false`;
      const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}&aggregated=false`;
      const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}&aggregated=false`;
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
    const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
    const GIRO_CHECKOUT_URL =
      "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
    const type = "SALE";
    const test = 1;
    const currency = "EUR";

    const merchantTxId = this.groupBookingId
      ? `${this.groupBookingId}`
      : `${this.bookingIds.join(",")}`;
    const amount = Math.round(
      bookings.reduce((acc, booking) => acc + booking.priceEur * 100, 0),
    ).toString();

    const purpose = this.groupBookingId
      ? `${this.groupBookingId} ${paymentApp.paymentPurposeSuffix || ""}`
      : `${this.bookingIds.join(",")} ${paymentApp.paymentPurposeSuffix || ""}`;

    const MERCHANT_ID = paymentApp.paymentMerchantId;
    const PROJECT_ID = paymentApp.paymentProjectId;
    const PROJECT_SECRET = paymentApp.paymentSecret;

    const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${merchantTxId}&aggregated=true`;
    const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}&aggregated=true`;
    const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}&aggregated=true`;
    const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}&aggregated=true`;
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
      return [{ bookingIds: this.bookingIds, url: response.data?.url }];
    } else {
      logger.warn("could not get payment url.", response.data);
      throw new Error("could not get payment url.");
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
      if (!this.bookingIds || !this.tenantId) {
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
          `${this.tenantId} -- payment notification hash mismatch. For Bookings ${this.bookingIds}`,
        );
        throw new Error("Hash mismatch");
      }

      if (gcResultPayment === GiroCockpitPaymentService.GIRO_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- GiroCockpit responds with status ${GiroCockpitPaymentService.GIRO_SUCCESS_CODE} / successfully payed for bookings ${this.bookingIds} .`,
        );

        const paymentMapping = {
          1: "GIROPAY",
          17: "GIROPAY",
          18: "GIROPAY",
          2: "EPS",
          12: "IDEAL",
          11: "CREDIT_CARD",
          6: "TRANSFER",
          7: "TRANSFER",
          26: "BLUECODE",
          33: "MAESTRO",
          14: "PAYPAL",
          23: "PAYDIRECT",
          27: "SOFORT",
        };

        await this.handleSuccessfulPayment({
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod: paymentMapping[gcPaymethod] || "OTHER",
        });

        logger.info(
          `${this.tenantId} -- bookings ${this.bookingIds} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- bookings ${this.bookingIds} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
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

module.exports = GiroCockpitPaymentService;
