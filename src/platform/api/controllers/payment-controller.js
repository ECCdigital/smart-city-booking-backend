const crypto = require("crypto");
const axios = require("axios");
const qs = require("qs");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "payment-controller.js",
  level: process.env.LOG_LEVEL,
});

class PaymentController {
  static async getPaymentUrl(request, response) {
    const GIRO_CHECKOUT_URL =
      "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";

    const type = "SALE";
    const test = 1;
    const currency = "EUR";

    const merchantTxId = request.body?.bookingId;
    const tenantId = request.params?.tenant;

    const tenant = await TenantManager.getTenant(tenantId);

    const MERCHANT_ID = tenant.paymentMerchantId;
    const PROJECT_ID = tenant.paymentProjectId;
    const PROJECT_SECRET = tenant.paymentSecret;

    const notifyUrl = `${request.protocol}://${request.get(
      "host",
    )}/api/${tenantId}/payments/notify`;
    const successUrl = `${request.protocol}://${request.get(
      "host",
    )}/api/${tenantId}/payments/response?id=${merchantTxId}&tenant=${tenantId}&status=success`;
    const failUrl = `${request.protocol}://${request.get(
      "host",
    )}/api/${tenantId}/payments/response?id=${merchantTxId}&tenant=${tenantId}&status=fail`;
    const backUrl = `${request.protocol}://${request.get(
      "host",
    )}/api/${tenantId}/payments/response?id=${merchantTxId}&tenant=${tenantId}&status=back`;

    const booking = await BookingManager.getBooking(merchantTxId, tenantId);

    const amount = (booking.priceEur * 100 || 0).toString();

    const purpose = `${booking.id} ${tenant.paymentPurposeSuffix || ""}`;

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

    axios(config)
      .then(function (res) {
        const paymentUrl = res.data?.url;

        if (paymentUrl) {
          logger.info(
            `Payment URL requested for booking ${merchantTxId}: ${paymentUrl}`,
          );
          response.status(200).send({ paymentUrl });
        } else {
          logger.warn("could not get payment url.", res.data);
          response.sendStatus(500);
        }
      })
      .catch(function (error) {
        logger.error(error);
        response.sendStatus(400);
      });
  }

  static async paymentNotification(request, response) {
    const merchantTxId = request.query?.gcMerchantTxId;
    const paymentResult = request.query?.gcResultPayment;
    const payMethod = request.query?.gcPaymethod;
    const tenantId = request.params?.tenant;

    const tenant = await TenantManager.getTenant(tenantId);
    const PROJECT_SECRET = tenant.paymentSecret;

    const booking = await BookingManager.getBooking(merchantTxId, tenantId);
    const hashString =
      request.query?.gcPaymethod +
      request.query?.gcType +
      request.query?.gcProjectId +
      request.query?.gcReference +
      request.query?.gcMerchantTxId +
      request.query?.gcBackendTxId +
      request.query?.gcAmount +
      request.query?.gcCurrency +
      request.query?.gcResultPayment;
    const hash = crypto
      .createHmac("md5", PROJECT_SECRET)
      .update(hashString)
      .digest("hex");

    if (paymentResult && merchantTxId) {
      if (hash !== request.query?.gcHash) {
        response.sendStatus(401);
      } else {
        if (!booking._id) {
          response.sendStatus(404);
        } else {
          if (paymentResult === "4000") {
            logger.info(
              `${tenantId} -- GrioPay responds with status 4000 / successfully payed for booking ${merchantTxId} .`,
            );

            booking.isPayed = true;
            booking.payMethod = payMethod;

            await BookingManager.setBookingPayedStatus(booking);
            await MailController.sendBookingConfirmation(
              booking.mail,
              booking.id,
              booking.tenant,
            );

            logger.info(
              `${tenantId} -- booking ${merchantTxId} successfully payed and updated.`,
            );
            response.sendStatus(200);
          } else {
            // await BookingManager.removeBooking(merchantTxId, tenant)
            logger.warn(
              `${tenantId} -- booking ${merchantTxId} could not be payed.`,
              response.data,
            );
            response.sendStatus(200);
          }
        }
      }
    } else {
      logger.warn(
        `${tenantId} -- could not get payment result for booking ${merchantTxId}.`,
      );
      response.sendStatus(400);
    }
  }

  static async paymentResponse(request, response) {
    response.redirect(
      302,
      `${process.env.FRONTEND_URL}/checkout/status?${request._parsedOriginalUrl?.query}`,
    );
  }
}

module.exports = PaymentController;
