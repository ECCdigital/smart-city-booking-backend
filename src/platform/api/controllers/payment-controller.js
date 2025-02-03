const BookingManager = require("../../../commons/data-managers/booking-manager");
const bunyan = require("bunyan");
const PaymentUtils = require("../../../commons/utilities/payment-utils");
const LockerService = require("../../../commons/services/locker/locker-service");

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

    if (!booking?.id) {
      response.status(400).send({ message: "Booking not found", code: 0 });
      return;
    }

    if (!booking.isCommitted) {
      response.status(400).send({ message: "Booking not committed", code: 1 });
      return;
    }

    if (booking.isPayed) {
      response.status(400).send({ message: "Booking already payed", code: 2 });
      return;
    }

    try {
      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingId,
        booking.paymentProvider,
      );

      const data = await paymentService?.createPayment();
      response.status(200).send({ paymentData: data, booking });
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }

  static async paymentNotificationGET(request, response) {
    const {
      params: { tenant: tenantId },
      query: { id: bookingId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    try {
      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingId,
        booking.paymentProvider,
      );

      await paymentService.paymentNotification(request.query);
      try {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleCreate(booking.tenant, booking.id);
      } catch (err) {
        logger.error(err);
      }
      logger.info(
        `${tenantId} -- booking ${bookingId} successfully payed and updated.`,
      );
      response.sendStatus(200);
    } catch {
      logger.warn(
        `${tenantId} -- could not get payment result for booking ${bookingId}.`,
      );
      response.sendStatus(400);
    }
  }
  static async paymentNotificationPOST(request, response) {
    const {
      params: { tenant: tenantId },
      query: { id: bookingId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    try {
      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingId,
        booking.paymentProvider,
      );

      await paymentService.paymentNotification(request.body);
      try {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleCreate(booking.tenant, booking.id);
      } catch (err) {
        logger.error(err);
      }
      logger.info(
        `${tenantId} -- booking ${bookingId} successfully payed and updated.`,
      );
      response.sendStatus(200);
    } catch {
      logger.warn(
        `${tenantId} -- could not get payment result for booking ${bookingId}.`,
      );
      response.sendStatus(400);
    }
  }

  static async paymentResponse(request, response) {
    const {
      query: { id: bookingId, tenant: tenantId },
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    if (!booking.id) {
      logger.warn(
        `${tenantId} -- could not get booking for bookingId ${bookingId}.`,
      );
      response.sendStatus(404);
      return;
    }
    try {
      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingId,
        booking.paymentProvider,
      );

      const url = paymentService.paymentResponse();
      response.redirect(302, url);
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }
}

module.exports = PaymentController;
