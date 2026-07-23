const BookingManager = require("../../../commons/data-managers/booking-manager");
const GroupBookingManager = require("../../../commons/data-managers/group-booking-manager");
const bunyan = require("bunyan");
const PaymentUtils = require("../../../commons/utilities/payment-utils");
const LockerService = require("../../../commons/services/locker/locker-service");
const PermissionService = require("../../../commons/services/permission-service");

const logger = bunyan.createLogger({
  name: "payment-controller.js",
  level: process.env.LOG_LEVEL,
});

class PaymentController {
  /**
   * Resolves booking IDs - if an ID starts with "G-", it's a group booking
   * and we fetch the actual booking IDs from the group.
   */
  static async _resolveBookingIds(tenantId, ids) {
    const resolvedIds = [];

    for (const id of ids) {
      if (id.startsWith("G-")) {
        const groupBooking = await GroupBookingManager.getGroupBooking(
          tenantId,
          id,
        );
        if (groupBooking && groupBooking.bookingIds) {
          resolvedIds.push(...groupBooking.bookingIds);
        } else {
          logger.warn(`${tenantId} -- could not resolve group booking ${id}`);
        }
      } else {
        resolvedIds.push(id);
      }
    }

    return resolvedIds;
  }

  static async createPayment(request, response) {
    const {
      params: { tenant: tenantId },
      body: { bookingIds, aggregated },
    } = request;

    logger.debug(
      `Create payment request received for tenant ${tenantId}, bookingIds ${bookingIds}, aggregated ${aggregated}`,
    );

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

    try {
      const lockerServiceInstance = LockerService.getInstance();
      await lockerServiceInstance.refreshPreReservations(tenantId, bookingIds);
    } catch (err) {
      logger.warn(`${tenantId} -- Locker reservation failed: ${err.message}`);
      response.status(409).send({
        message: "Locker not available anymore.",
        code: 3,
      });
      return;
    }

    let groupBookingId = null;

    if (bookings.length > 1 && aggregated) {
      const possibleGroupBookingIds =
        await GroupBookingManager.getGroupBookingsByBookingIds(
          tenantId,
          bookingIds,
        );
      if (possibleGroupBookingIds.length === 1) {
        groupBookingId = possibleGroupBookingIds[0].id;
      }
    }

    //TODO: Check if all bookings are in the same tenant and have the same payment provider

    // Check invoice payment permission
    if (bookings[0].paymentProvider?.toLowerCase() === "invoice") {
      const userId = request.user?.id;
      const isPermitted = await PaymentUtils.checkInvoicePermission(
        tenantId,
        userId,
      );
      if (!isPermitted) {
        response.status(403).send({
          message: "Sie sind nicht berechtigt, per Rechnung zu bezahlen.",
          code: 4,
        });
        return;
      }
    }

    try {
      logger.debug(
        `Getting payment service for tenant ${tenantId}, bookingIds ${bookingIds}, paymentProvider ${bookings[0].paymentProvider}, aggregated ${aggregated}, groupBookingId ${groupBookingId}`,
      );

      let paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingIds,
        bookings[0].paymentProvider,
        { aggregated, groupBookingId },
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

    const isAggregated = aggregated === "true";

    logger.info(
      `Payment notification GET received for tenant ${tenantId}, bookingId ${bookingId}, bookingIds ${bookingIds}, aggregated ${isAggregated}`,
    );

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

    aggregatedBookingIds = await PaymentController._resolveBookingIds(
      tenantId,
      aggregatedBookingIds,
    );

    const bookings = await BookingManager.getBookings(
      tenantId,
      aggregatedBookingIds,
    );

    try {
      const paymentResults = [];

      if (isAggregated) {
        const options = { aggregated: isAggregated };
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          options,
        );
        paymentResults.push(
          await paymentService.paymentNotification(request.query),
        );
      } else {
        for (const booking of bookings) {
          let paymentService = await PaymentUtils.getPaymentService(
            tenantId,
            booking.id,
            booking.paymentProvider,
          );
          paymentResults.push(
            await paymentService.paymentNotification(request.query),
          );
        }
      }

      if (paymentResults.every(Boolean)) {
        logger.info(
          `${tenantId} -- bookings ${aggregatedBookingIds} successfully payed and updated.`,
        );
      } else {
        logger.warn(
          `${tenantId} -- payment notification processed without successful payment for bookings ${aggregatedBookingIds}.`,
        );
      }
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

    const isAggregated = aggregated === "true";

    logger.info(
      `Payment notification POST received for tenant ${tenantId}, bookingId ${bookingId}, bookingIds ${bookingIds}, aggregated ${isAggregated}`,
    );

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

    aggregatedBookingIds = await PaymentController._resolveBookingIds(
      tenantId,
      aggregatedBookingIds,
    );

    const bookings = await BookingManager.getBookings(
      tenantId,
      aggregatedBookingIds,
    );

    try {
      const paymentResults = [];

      if (isAggregated) {
        const options = { aggregated: isAggregated };
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          options,
        );
        paymentResults.push(
          await paymentService.paymentNotification(request.body),
        );
      } else {
        for (const booking of bookings) {
          let paymentService = await PaymentUtils.getPaymentService(
            tenantId,
            booking.id,
            booking.paymentProvider,
          );
          paymentResults.push(
            await paymentService.paymentNotification(request.body),
          );
        }
      }

      if (paymentResults.every(Boolean)) {
        logger.info(
          `${tenantId} -- booking ${aggregatedBookingIds} successfully payed and updated.`,
        );
      } else {
        logger.warn(
          `${tenantId} -- payment notification processed without successful payment for booking ${aggregatedBookingIds}.`,
        );
      }
      response.sendStatus(200);
    } catch {
      logger.warn(
        `${tenantId} -- could not get payment result for booking ${aggregatedBookingIds}.`,
      );
      response.sendStatus(400);
    }
  }

  static async paymentResponse(request, response) {
    const {
      query: { id: bookingId, ids: bookingIds, tenant: tenantId, aggregated },
    } = request;

    logger.info(
      `Payment response received for tenant ${tenantId}, bookingId ${bookingId}, bookingIds ${bookingIds}, aggregated ${aggregated}`,
    );

    let aggregatedBookingIds = bookingIds
      ? bookingIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    if (bookingId) {
      aggregatedBookingIds.push(bookingId);
    }

    aggregatedBookingIds = await PaymentController._resolveBookingIds(
      tenantId,
      aggregatedBookingIds,
    );

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
        const options = { aggregated };
        let paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          bookings.map((booking) => booking.id),
          bookings[0].paymentProvider,
          options,
        );
        const url = await paymentService.paymentResponse();
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

  static async testConnection(request, response) {
    const { tenant: tenantId, provider } = request.params;

    const user = request.user;
    const hasPermission =
      (await PermissionService._isTenantOwner(user.id, request.body.id)) ||
      (await PermissionService._isInstanceOwner(user.id));

    if (!hasPermission) {
      response.status(403).send({
        success: false,
        message:
          "Forbidden: You don't have permission to test this payment provider.",
      });
      return;
    }

    try {
      const paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        null,
        provider,
        {},
      );

      const result = await paymentService.testConnection();

      const statusCode = result.success ? 200 : 503;
      response.status(statusCode).send(result);
    } catch (error) {
      logger.error(error);
      response.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = PaymentController;
