const crypto = require("crypto");
const axios = require("axios");
const qs = require("qs");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const bunyan = require("bunyan");
const PdfService = require("../../../commons/pdf-service/pdf-service");
const ReceiptService = require("../../../commons/services/receipt/receipt-service");
const FileManager = require("../../../commons/data-managers/file-manager");
const { GiroCockpitPaymentService } = require("../../../commons/services/payment/payment-service");

const logger = bunyan.createLogger({
  name: "payment-controller.js",
  level: process.env.LOG_LEVEL,
});

class PaymentController {
  static async createPayment(request, response) {
    const {
      params: { tenant: tenantId },
      body: { bookingId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);

    let paymentService = {};

    switch (booking.paymentMethod) {
      case "giroCockpit":
        paymentService = new GiroCockpitPaymentService(tenantId, bookingId);
        break;
      default:
        return response.sendStatus(400);
    }

    try {
      const data =  await paymentService.createPayment();
      response.status(200).send({ paymentMethod: booking.paymentMethod, data });
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
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

            let attachments = [];
            try {
              if (booking.priceEur > 0) {

                const pdfData = await ReceiptService.createReceipt(tenantId, booking.id);

                attachments = [
                  {
                    filename: pdfData.name,
                    content: pdfData.buffer,
                    contentType: "application/pdf",
                  },
                ];
              }
            } catch (err) {
              logger.error(err);
            }


            await MailController.sendBookingConfirmation(
              booking.mail,
              booking.id,
              booking.tenant,
              attachments,
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
