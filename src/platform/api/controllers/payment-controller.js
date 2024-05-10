const BookingManager = require("../../../commons/data-managers/booking-manager");
const bunyan = require("bunyan");
const {
  GiroCockpitPaymentService, InvoicePaymentService,
} = require("../../../commons/services/payment/payment-service");
const TenantManager = require("../../../commons/data-managers/tenant-manager");

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

    try {
      let paymentService = await getPaymentService(
        tenantId,
        bookingId,
        booking.paymentMethod,
      );

      const data = await paymentService.createPayment();
      response.status(200).send({ paymentMethod: booking.paymentMethod, data });
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }

  static async paymentNotification(request, response) {
    const {
      params: { tenant: tenantId },
      query: { id: bookingId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    try {
      let paymentService = await getPaymentService(
        tenantId,
        bookingId,
        booking.paymentMethod,
      );

      await paymentService.paymentNotification(request);
      response.sendStatus(200);
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }

  static async paymentResponse(request, response) {
    const {
      query: { id: bookingId, tenant: tenantId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    try {
      let paymentService = await getPaymentService(
        tenantId,
        bookingId,
        booking.paymentMethod,
      );

      const url = paymentService.paymentResponse();
      response.redirect(302, url);
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }
}

async function getPaymentService(tenantId, bookingId, paymentMethod) {
  const paymentMethods = {
    "giroCockpit": GiroCockpitPaymentService,
    "invoice": InvoicePaymentService
  };
  const serviceClass = paymentMethods[paymentMethod];
  if (!serviceClass) return null;

  const paymentApp = await TenantManager.getTenantApp(tenantId, paymentMethod);
  if (!paymentApp || !paymentApp.active) {
    throw new Error(`${paymentMethod} payment app not found or inactive.`);
  }

  return new serviceClass(tenantId, bookingId);
}

module.exports = PaymentController;
