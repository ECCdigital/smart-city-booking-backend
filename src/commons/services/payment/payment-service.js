const { getBooking } = require("../../data-managers/booking-manager");
const { getTenantApp } = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const SecurityUtils = require("../../utilities/security-utils");
const BookingManager = require("../../data-managers/booking-manager");

const logger = bunyan.createLogger({
  name: "payment-controller.js",
  level: process.env.LOG_LEVEL,
});

class PaymentService {
  constructor(tenantId, bookingId) {
    this.tenantId = tenantId;
    this.bookingId = bookingId;
  }

  createPayment() {}

  paymentNotification() {}

  paymentResponse() {}
}

class GiroCockpitPaymentService extends PaymentService {

  async createPayment() {
    const booking = await getBooking(this.bookingId, this.tenantId);
    const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");

    if (!paymentApp || !paymentApp.active) {
      throw new Error("GiroCockpit payment app not found or inactive.");
    }
    try {
      const GIRO_CHECKOUT_URL =
        "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
      const type = "SALE";
      const test = 1;
      const currency = "EUR";

      const merchantTxId = this.bookingId;
      const amount = (booking.priceEur * 100 || 0).toString();
      const purpose = `${this.bookingId} ${paymentApp.paymentPurposeSuffix || ""}`;

      const MERCHANT_ID = SecurityUtils.decrypt(paymentApp.paymentMerchantId);
      const PROJECT_ID = SecurityUtils.decrypt(paymentApp.paymentProjectId);
      const PROJECT_SECRET = SecurityUtils.decrypt(paymentApp.paymentSecret);

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify`;
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

      if(response.data?.url) {
        logger.info(
          `Payment URL requested for booking ${merchantTxId}: ${response.data?.url}`,
        );
        return response.data?.url;
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }

    } catch (error) {
      throw new Error(error);
    }
  }

  async paymentNotification(request, response) {
    const {
      params: { tenant: tenantId },
      query: {
        gcMerchantTxId: bookingId,
        gcResultPayment: paymentResult,
        gcPaymethod,
        gcType,
        gcProjectId,
        gcReference,
        gcBackendTxId,
        gcAmount,
        gcCurrency,
        gcHash,
        gcPaymentMethod: payMethod
      },
    } = request;

    try {


      if (!bookingId || !tenantId) {
        logger.warn(`${tenantId} -- could not validate payment notification. Missing parameters. For Booking ${bookingId}`);
        throw new Error("Missing parameters");
      }

      const booking = await BookingManager.getBooking(bookingId, tenantId);
      const paymentApp = await getTenantApp(tenantId, "giroCockpit");
      const PROJECT_SECRET = paymentApp.paymentSecret;


      const hashString =
        gcPaymethod +
        gcType +
        gcProjectId +
        gcReference +
        bookingId +
        gcBackendTxId +
        gcAmount +
        gcCurrency +
        paymentResult;

      const hash = crypto
        .createHmac("md5", PROJECT_SECRET)
        .update(hashString)
        .digest("hex");

      if (gcHash !== hash) {
        logger.warn(`${tenantId} -- payment notification hash mismatch. For Booking ${bookingId}`);
        throw new Error("Hash mismatch");
      }

      if (paymentResult === "4000") {
        logger.info(
          `${tenantId} -- GiroCockpit responds with status 4000 / successfully payed for booking ${bookingId} .`,
        );
        booking.isPayed = true;
        booking.payMethod = payMethod;
        await BookingManager.setBookingPayedStatus(booking);

        //TODO: create payment receipt and send mail

        logger.info(
          `${tenantId} -- booking ${bookingId} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${tenantId} -- booking ${bookingId} could not be payed.`, response.data);
        return true;
      }

    } catch (error) {
      throw new Error(error);
    }
  }

  paymentResponse() {}
}

module.exports = {
  GiroCockpitPaymentService,
}