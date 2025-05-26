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
      body: { bookingIds, aggregated },
    } = request;

    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    if (!bookings) {
      response.status(400).send({ message: "Bookings not found", code: 0 });
      return;
    }

    if (!bookings.every((booking) => booking.isCommitted)) {
      response
        .status(400)
        .send({ message: "All bookings must be committed", code: 1 });
      return;
    }

    if (bookings.some((booking) => booking.isPayed)) {
      response
        .status(400)
        .send({ message: "All bookings must not be payed", code: 2 });
      return;
    }

    //TODO: Check if all bookings are in the same tenant and have the same payment provider

    try {
      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingIds,
        bookings[0].paymentProvider,
        { aggregated },
      );

      const data = await paymentService?.createPayment();

      response.status(200).send({ paymentData: data, bookings });
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }

  static async paymentNotificationGET(request, response) {
    const {
      params: { tenant: tenantId },
      query: { id: bookingId, ids: bookingIds, aggregated },
    } = request;

    let aggregatedBookingIds = bookingIds
      ? bookingIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    if (bookingId) {
      aggregatedBookingIds.push(bookingId);
    }
    aggregatedBookingIds = aggregatedBookingIds.filter((id) => !!id);

    const bookings = await BookingManager.getBookings(
      tenantId,
      aggregatedBookingIds,
    );

    try {
      if (aggregated) {
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          aggregated,
        );
        await paymentService.paymentNotification(request.query);
      } else {
        for (const booking of bookings) {
          let paymentService = await PaymentUtils.getPaymentService(
            tenantId,
            booking.id,
            booking.paymentProvider,
          );
          await paymentService.paymentNotification(request.query);
        }
      }

      for (const booking of bookings) {
        try {
          const lockerServiceInstance = LockerService.getInstance();
          await lockerServiceInstance.handleCreate(
            booking.tenantId,
            booking.id,
          );
        } catch (err) {
          logger.error(err);
        }
      }

      logger.info(
        `${tenantId} -- bookings ${aggregatedBookingIds} successfully payed and updated.`,
      );
      response.sendStatus(200);
    } catch {
      logger.warn(
        `${tenantId} -- could not get payment result for bookings ${aggregatedBookingIds}.`,
      );
      response.sendStatus(400);
    }
  }
  static async paymentNotificationPOST(request, response) {
    const {
      params: { tenant: tenantId },
      query: { id: bookingId, ids: bookingIds, aggregated },
    } = request;

    let aggregatedBookingIds = bookingIds
      ? bookingIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    if (bookingId) {
      aggregatedBookingIds.push(bookingId);
    }
    aggregatedBookingIds = aggregatedBookingIds.filter((id) => !!id);

    const bookings = await BookingManager.getBookings(
      tenantId,
      aggregatedBookingIds,
    );

    try {
      if (aggregated) {
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          { aggregated },
        );
        await paymentService.paymentNotification(request.body);
      } else {
        for (const booking of bookings) {
          let paymentService = await PaymentUtils.getPaymentService(
            tenantId,
            booking.id,
            booking.paymentProvider,
          );
          await paymentService.paymentNotification(request.body);
        }
      }

      try {
        for (const booking of bookings) {
          const lockerServiceInstance = LockerService.getInstance();
          await lockerServiceInstance.handleCreate(
            booking.tenantId,
            booking.id,
          );
        }
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
      query: { id: bookingId, ids: bookingIds, tenant: tenantId, aggregated },
    } = request;

    let aggregatedBookingIds = bookingIds
      ? bookingIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    if (bookingId) {
      aggregatedBookingIds.push(bookingId);
    }
    aggregatedBookingIds = aggregatedBookingIds.filter((id) => !!id);

    const bookings = await BookingManager.getBookings(
      tenantId,
      aggregatedBookingIds,
    );
    if (!bookings.length) {
      logger.warn(
        `${tenantId} -- could not get booking for bookingId ${bookingId}.`,
      );
      response.sendStatus(404);
      return;
    }
    try {
      if (aggregated) {
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          aggregated,
        );
        const url = paymentService.paymentResponse();
        response.redirect(302, url);
      } else {
        const urls = [];
        for (const booking of bookings) {
          let paymentService = await PaymentUtils.getPaymentService(
            tenantId,
            booking.id,
            booking.paymentProvider,
          );
          urls.push({
            bookingId: booking.id,
            url: await paymentService.paymentResponse(),
          });
        }

        const firstUrl = urls[0].url;
        const url = new URL(firstUrl);
        const params = new URLSearchParams(url.search);
        const bookingIds = urls.map((booking) => booking.bookingId);
        params.set("ids", bookingIds.join(","));
        url.search = params.toString();
        response.redirect(302, url);
      }
    } catch (error) {
      logger.error(error);
      response.sendStatus(400);
    }
  }
}

module.exports = PaymentController;
