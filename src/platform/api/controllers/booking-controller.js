const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  Booking,
  BOOKING_HOOK_TYPES,
} = require("../../../commons/entities/booking/booking");
const bunyan = require("bunyan");
const ReceiptService = require("../../../commons/services/payment/receipt-service");
const InvoiceService = require("../../../commons/services/payment/invoice-service");
const {
  issue: issueDocument,
} = require("../../../commons/services/documents/document-issuance");
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");
const BookingService = require("../../../commons/services/checkout/booking-service");
const BookingCheckout = require("../../../commons/services/checkout/booking-checkout");
const {
  bookingLifecycle,
  bookingDeletion,
  TRANSITION,
  TRIGGER,
} = require("../../../commons/services/booking-lifecycle");
const { answerTransitionError } = require("./transition-error-answer");
const {
  CheckoutPolicy,
} = require("../../../commons/services/checkout/checkout-policy");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const { decide, scopeOf } = require("../../../commons/services/authorization");
const {
  resolveCheckoutId,
} = require("../../../commons/utilities/checkout-utils");
const CancellationReceiptService = require("../../../commons/services/payment/cancellation-service");
const mailService = require("../../../commons/mail-service");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const {
  CancellationRefundService,
} = require("../../../commons/services/payment/cancellation-refund-service");

const logger = bunyan.createLogger({
  name: "booking-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * A booking as the request describes it. The HTTP form speaks in the three
 * flags; a `status` the client sends back from a GET is not an input and
 * would otherwise outrank the flags it edited.
 */
function bookingFromRequest(body = {}) {
  const fields = { ...body };
  delete fields.status;
  return new Booking(fields);
}

/**
 * Web Controller for Bookings.
 */
class BookingController {
  static _resolvePrimaryBookableId(booking) {
    if (booking.bookableId) {
      return booking.bookableId;
    }

    return booking.bookableItems?.[0]?.bookableId ?? null;
  }

  static async _populate(bookings) {
    if (!bookings.length) {
      return;
    }

    const tenantId = bookings[0].tenantId;
    const bookableIds = [
      ...new Set(
        bookings
          .map((booking) =>
            BookingController._resolvePrimaryBookableId(booking),
          )
          .filter(Boolean),
      ),
    ];

    const [bookables, workflowStatusMap] = await Promise.all([
      BookableManager.getBookablesByIdsWithCustomFields(tenantId, bookableIds),
      WorkflowService.getWorkflowStatusMap(tenantId),
    ]);

    const bookableById = new Map(
      bookables.map((bookable) => [bookable.id, bookable]),
    );

    for (const booking of bookings) {
      const bookableId = BookingController._resolvePrimaryBookableId(booking);
      booking._populated = {
        bookable: bookableId ? bookableById.get(bookableId) ?? null : null,
        workflowStatus: WorkflowService.resolveWorkflowStatus(
          workflowStatusMap,
          booking.id,
        ),
      };
    }
  }

  static anonymizeBooking(booking) {
    return {
      id: booking.id,
      tenantId: booking.tenantId,
      bookableIds: booking.bookableIds,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
    };
  }

  /**
   * Get all bookings. With the public flag the anonymized projection of every
   * booking, for anyone; otherwise the bookings within the reach of the
   * request (authorize spec §4.1) - the public has none and is refused.
   * @param request
   * @param response
   * @param next
   * @returns {Promise<void>}
   */
  static async getBookings(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      if (request.query.public === "true") {
        const bookings = await BookingManager.getTenantBookings(tenant);
        const anonymizedBookings = bookings.map((b) => {
          return BookingController.anonymizeBooking(b);
        });

        logger.info(
          `${tenant} -- sending ${anonymizedBookings.length} anonymized bookings to user ${user?.id}`,
        );
        return response.status(200).send(anonymizedBookings);
      }

      if (request.reach === "public") {
        logger.warn(
          `${tenant} -- could not get bookings. User is not authenticated`,
        );
        return next(new ForbiddenError());
      }

      const allowedBookings = await BookingManager.getTenantBookings(
        tenant,
        scopeOf(request),
      );

      if (request.query.populate === "true") {
        await BookingController._populate(allowedBookings);
      }

      logger.info(
        `${tenant} -- sending ${allowedBookings.length} allowed bookings to user ${user?.id}`,
      );
      response.status(200).send(allowedBookings);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get bookings");
    }
  }

  /**
   * Get all Bookings assigned to the current user.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getAssignedBookings(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const filter = tenant ? { tenantId: tenant } : {};

      const bookings = await BookingManager.getAssignedBookings({
        userID: request.principal.userId,
        filter,
      });

      if (request.query.populate === "true") {
        await BookingController._populate(bookings);
      }

      logger.info(
        `${tenant} -- sending ${bookings.length} assigned bookings to user ${user?.id}`,
      );
      response.status(200).send(bookings);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get assigned bookings");
    }
  }

  /**
   * Get all Bookings including those that have a relation to parent or child bookables.
   * With the public flag the anonymized projection of every booking, for
   * anyone; otherwise the bookings within the reach of the request (authorize
   * spec §4.1) - the public has none and is refused.
   * @param request
   * @param response
   * @param next
   * @returns {Promise<void>}
   */
  static async getRelatedBookings(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const bookableId = request.params.id;

      const isPublicView = request.query.public === "true";
      const includeRelatedBookings = request.query.related === "true";
      const includeParentBookings = request.query.parent === "true";

      if (!isPublicView && request.reach === "public") {
        return next(new ForbiddenError());
      }
      const scope = isPublicView ? undefined : scopeOf(request);

      let bookings = await BookingManager.getRelatedBookings(
        tenant,
        bookableId,
        scope,
      );

      if (includeRelatedBookings) {
        let relatedBookables = await BookableManager.getRelatedBookables(
          bookableId,
          tenant,
        );

        let relatedBookings = [];
        for (let relatedBookable of relatedBookables) {
          const bookingsForRelated = await BookingManager.getRelatedBookings(
            tenant,
            relatedBookable.id,
            scope,
          );
          relatedBookings = relatedBookings.concat(bookingsForRelated || []);
        }
        bookings = bookings.concat(relatedBookings);
      }

      if (includeParentBookings) {
        let parentBookables = await BookableManager.getAncestorBookables(
          bookableId,
          tenant,
        );
        let parentBookings = [];
        for (let parentBookable of parentBookables) {
          const bookingsForParent = await BookingManager.getRelatedBookings(
            tenant,
            parentBookable.id,
            scope,
          );
          parentBookings = parentBookings.concat(bookingsForParent || []);
        }
        bookings = bookings.concat(parentBookings);
      }

      bookings = Array.from(
        new Map(bookings.map((booking) => [booking.id, booking])).values(),
      );

      if (isPublicView) {
        const anonymizedBookings = bookings.map((b) => {
          return {
            id: b.id,
            tenantId: b.tenantId,
            bookableId: b.bookableId,
            timeBegin: b.timeBegin,
            timeEnd: b.timeEnd,
          };
        });

        response.status(200).send(anonymizedBookings);
      } else {
        response.status(200).send(bookings);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get related bookings");
    }
  }

  /**
   * Get a single booking.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBooking(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const id = request.params.id;

      if (id) {
        // The booking within the reach of the request; none there is a 404.
        const booking = await BookingManager.getBooking(
          id,
          tenantId,
          scopeOf(request),
        );
        if (!booking) {
          const error = new NotFoundError("booking_not_found", {
            bookingId: id,
          });
          return response.status(error.statusCode).json(error.toJSON());
        }

        await BookingController._populate([booking]);
        logger.info(`${tenantId} -- sending booking ${id} to user ${user?.id}`);
        response.status(200).send(booking);
      } else {
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get booking");
    }
  }

  /**
   * Get the status of a booking.
   *
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBookingStatus(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const ids = request.params.ids;

      if (ids) {
        const splitIds = ids.split(",");

        const bookingsStatus = await BookingManager.getBookingStatus(
          tenantId,
          splitIds,
        );

        logger.info(
          `${tenantId} -- sending booking status ${bookingsStatus} for booking ${ids} to user ${user?.id}`,
        );
        response.status(200).send(bookingsStatus);
      } else {
        logger.warn(
          `${tenantId} -- could not get booking status. No booking ID provided`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get booking status");
    }
  }

  /**
   * @obsolete Use createBooking or updateBooking instead.
   * @param request
   * @param response
   * @param next
   * @returns {Promise<void>}
   */
  static async storeBooking(request, response, next) {
    const booking = bookingFromRequest(request.body);

    let isUpdate =
      !!(await BookingManager.getBooking(booking.id, booking.tenantId)) &&
      !!booking.id;

    if (isUpdate) {
      await BookingController.updateBooking(request, response, next);
    } else {
      await BookingController.createBooking(request, response, next);
    }
  }

  static async createBooking(request, response, next) {
    const user = request.user;
    const booking = bookingFromRequest(request.body);
    const tenantId = request.params.tenant;

    // The obsolete PUT carries the update marker; the creation is the
    // adapter's second decision (authorize spec §5, §11).
    if (decide(request.principal, "booking", "create") !== "any") {
      logger.warn(
        `${booking.tenantId} -- User ${user?.id} is not allowed to create booking.`,
      );
      return next(new ForbiddenError());
    }

    const { checkoutId } = await resolveCheckoutId(
      undefined,
      booking.mail,
      tenantId,
    );

    try {
      const newBooking = await BookingCheckout.createSingleBooking({
        tenantId,
        user,
        simulate: false,
        bookingAttempt: request.body,
        policy: CheckoutPolicy.ADMIN_MANUAL,
        checkoutId,
      });
      return response.status(200).send(newBooking);
    } catch (err) {
      next(err);
    }
  }

  static async updateBooking(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const booking = bookingFromRequest(request.body);

      const savedBooking = await BookingCheckout.updateBooking(
        tenant,
        booking,
        { requestBody: request.body, userId: user.id },
      );

      await WorkflowService.updateTask(
        tenant,
        booking.id,
        request.body._populated?.workflowStatus,
      );

      logger.info(
        `${tenant} -- updated booking ${booking.id} by user ${user?.id}`,
      );
      response.status(201).send(savedBooking);
    } catch (err) {
      next(err);
    }
  }

  static async removeBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const id = request.params.id;
      if (id) {
        const booking = await BookingManager.getBooking(id, tenant);
        if (!booking) {
          const error = new NotFoundError("booking_not_found", {
            bookingId: id,
          });
          return response.status(error.statusCode).json(error.toJSON());
        }

        await bookingDeletion.remove(tenant, id);
        await WorkflowService.removeTask(tenant, id);
        logger.info(`${tenant} -- removed booking ${id} by user ${user?.id}`);
        response.sendStatus(200);
      } else {
        logger.warn(
          `${tenant} -- could not remove booking. No booking ID provided`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not remove booking");
    }
  }

  static async commitBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;
      if (!id) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenant);
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId: id });
        return response.status(error.statusCode).json(error.toJSON());
      }

      logger.info(
        `${tenant} -- committed booking ${booking.id} by user ${user?.id}`,
      );
      // The consistency check in front of the transition keeps its
      // answer; the transition itself throws or succeeds.
      const errors = BookingService.transitionErrors(TRANSITION.CONFIRM, [
        booking,
      ]);
      if (errors.length > 0) {
        logger.error(
          `${tenant} -- booking ${booking.id} cannot be committed: ${JSON.stringify(errors)}`,
        );
        return response.status(200).json({
          success: false,
          data: null,
          errors,
        });
      }

      await bookingLifecycle.confirm(tenant, booking.id, {
        trigger: TRIGGER.ADMIN,
      });

      return response.status(200).json({
        success: true,
        data: null,
        errors: [],
      });
    } catch (err) {
      answerTransitionError(err, response, {
        code: "booking_commit_failed",
        fallback: "Could not commit booking",
      });
    }
  }

  static async payBooking(request, response) {
    try {
      const { tenant, id } = request.params;
      const { user } = request;
      const { paymentMethod, timePaid } = request.body;
      if (!id) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenant);
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId: id });
        return response.status(error.statusCode).json(error.toJSON());
      }

      logger.info(
        `${tenant} -- setting booking ${booking.id} as paid by user ${user?.id}`,
      );
      await bookingLifecycle.pay(tenant, id, {
        trigger: TRIGGER.ADMIN,
        paymentMethod,
        timePaid,
      });
      return response.status(200).send({
        success: true,
        data: null,
        errors: [],
      });
    } catch (err) {
      answerTransitionError(err, response, {
        code: "set_booking_payed_failed",
        fallback: "Could not set booking as paid",
      });
    }
  }

  static async getCancellationRefundPreview(request, response) {
    try {
      const tenantId = request.params.tenant;
      const bookingId = request.params.id;
      // The booking within the reach of the request; none there is a 404.
      const booking = await BookingManager.getBooking(
        bookingId,
        tenantId,
        scopeOf(request),
      );

      if (!booking) {
        return response.sendStatus(404);
      }

      const preview = await BookingService.getCancellationRefundPreview(
        tenantId,
        bookingId,
      );
      return response.status(200).send(preview);
    } catch (err) {
      logger.error(err);
      return response
        .status(err.statusCode || 500)
        .send(err.message || "Could not calculate cancellation refund");
    }
  }

  static async getPublicCancellationRefundPreview(request, response) {
    try {
      const tenantId = request.params.tenant;
      const bookingId = request.params.id;
      const name = request.query.name;

      if (!tenantId || !bookingId || !name) {
        return response.status(400).send("Missing required parameters.");
      }

      const preview = await BookingService.getPublicCancellationRefundPreview(
        tenantId,
        bookingId,
        name,
      );
      return response.status(200).send(preview);
    } catch (err) {
      logger.error(err);
      return response
        .status(err.statusCode || 500)
        .send(err.message || "Could not calculate cancellation refund");
    }
  }

  static async getHookCancellationRefundPreview(request, response) {
    try {
      const tenantId = request.params.tenant;
      const bookingId = request.params.id;
      const hookId = request.params.hookId;

      if (!tenantId || !bookingId || !hookId) {
        return response.status(400).send("Missing required parameters.");
      }

      const preview = await BookingService.getHookCancellationRefundPreview(
        tenantId,
        bookingId,
        hookId,
      );
      return response.status(200).send(preview);
    } catch (err) {
      logger.error(err);
      return response
        .status(err.statusCode || 500)
        .send(err.message || "Could not calculate cancellation refund");
    }
  }

  static async rejectBooking(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;
      const { reason, skipCancellation, bankDetails, refundPercentage } =
        request.body || {};
      if (!id) {
        return response.sendStatus(400);
      }
      if (refundPercentage !== undefined) {
        try {
          CancellationRefundService.validateRefundPercentage(refundPercentage);
        } catch (error) {
          return response.status(400).send(error.code);
        }
      }

      const booking = await BookingManager.getBooking(id, tenantId);
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId: id });
        return response.status(error.statusCode).json(error.toJSON());
      }

      logger.info(
        `${tenantId} -- rejected booking ${booking.id} by user ${user?.id}`,
      );
      await bookingLifecycle.cancel(tenantId, id, {
        trigger: TRIGGER.ADMIN,
        reason,
        bankDetails: bankDetails || null,
        refundPercentage,
        cancelledByUserId: user.id,
        withDocument: !skipCancellation,
      });
      return response.sendStatus(200);
    } catch (err) {
      answerTransitionError(err, response, {
        code: "booking_rejection_failed",
        fallback: "Could not reject booking",
      });
    }
  }

  static async requestRejectBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;
      if (!id) {
        return response.sendStatus(400);
      }

      const payload = request.body || {};
      const reason = payload.reason ?? "";
      const bankDetails = payload.bankDetails ?? null;

      await bookingLifecycle.requestCancel(tenant, id, {
        trigger: TRIGGER.CUSTOMER,
        reason,
        bankDetails,
      });

      response.sendStatus(201);
    } catch (err) {
      answerTransitionError(err, response, {
        code: "booking_reject_request_failed",
        fallback: "Could not reject booking",
        body: (error) => ({ code: error.code, message: error.message }),
      });
    }
  }

  static async releaseBookingHook(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;
      const hookId = request.params.hookId;
      if (!id || !hookId) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenant);

      if (!booking || !booking.hooks || booking.hooks.length === 0) {
        return response.sendStatus(404);
      }

      const hook = booking.hooks.find((h) => h.id === hookId);
      if (hook) {
        if (hook.type === BOOKING_HOOK_TYPES.REJECT) {
          const { reason, bankDetails } = hook.payload || {};
          await bookingLifecycle.cancel(tenant, id, {
            trigger: TRIGGER.CUSTOMER,
            reason,
            hookId,
            bankDetails: bankDetails || null,
          });
        } else {
          return response.sendStatus(400);
        }
      } else {
        return response.sendStatus(404);
      }

      response.sendStatus(200);
    } catch (err) {
      answerTransitionError(err, response, {
        code: "booking_rejection_failed",
        fallback: "Could not reject booking",
      });
    }
  }

  static async getEventBookings(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const eventId = request.params.id;

      // The public sees no bookings of an event; the rest is the reach's
      // (authorize spec §4.1).
      const allowedBookings =
        request.reach === "public"
          ? []
          : await BookingManager.getEventBookings(
              tenantId,
              eventId,
              scopeOf(request),
            );

      logger.info(
        `${tenantId} -- sending ${allowedBookings.length} allowed event bookings to user ${user?.id}`,
      );
      response.status(200).send(allowedBookings);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get event bookings");
    }
  }

  static async getReceipt(request, response) {
    const {
      params: { tenant, id: bookingId, receiptId },
      user,
    } = request;

    try {
      if (!tenant || !bookingId || !receiptId) {
        logger.warn(`${tenant} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      // The booking within the reach of the request; none there is a 404.
      const booking = await BookingManager.getBooking(
        bookingId,
        tenant,
        scopeOf(request),
      );
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId });
        return response.status(error.statusCode).json(error.toJSON());
      }

      const receipt = await ReceiptService.getReceipt(
        tenant,
        receiptId,
        bookingId,
      );

      logger.info(
        `${tenant} -- sending receipt ${receiptId} to user ${user?.id}`,
      );
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename=${receiptId}`,
      );

      return response.status(200).send(receipt);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get receipt");
    }
  }

  /**
   * The booking a reprint is asked for: the one within the reach of the
   * request (authorize spec §4.1), else 404. Answers the request itself
   * and returns null where not.
   */
  static async _reprintable(request, response) {
    const {
      params: { tenant: tenantId, id: bookingId },
    } = request;

    const booking = await BookingManager.getBooking(
      bookingId,
      tenantId,
      scopeOf(request),
    );
    if (!booking) {
      response.status(404).send({ message: "Booking not found." });
      return null;
    }

    return booking;
  }

  static async createReceipt(request, response) {
    try {
      const {
        params: { tenant: tenantId, id: bookingId },
      } = request;

      if (!tenantId || !bookingId) {
        logger.warn(`${tenantId} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const booking = await BookingController._reprintable(request, response);
      if (!booking) return;

      const errors = BookingService.reprintErrors("receipt", [booking]);
      if (errors.length > 0) {
        logger.error(
          `${tenantId} -- booking ${booking.id} cannot get a receipt: ${JSON.stringify(errors)}`,
        );
        return response
          .status(200)
          .json({ success: false, data: null, errors });
      }

      // A reprint is a further revision of the receipt; nothing is mailed.
      await issueDocument({
        tenantId,
        bookingIds: [booking.id],
        type: "receipt",
      });

      const updatedBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );

      response
        .status(200)
        .json({ success: true, data: updatedBooking, errors: [] });
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not create receipt");
    }
  }

  /**
   * Reprints the cancellation document of a cancelled booking as a further
   * revision, from the refund audit the cancellation left behind. Same
   * right as the receipt reprint; a booking without a cancellation answers
   * 409 `not_cancelled`. Nothing is mailed.
   */
  static async createCancellationReceipt(request, response) {
    try {
      const {
        params: { tenant: tenantId, id: bookingId },
      } = request;

      if (!tenantId || !bookingId) {
        logger.warn(`${tenantId} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const booking = await BookingController._reprintable(request, response);
      if (!booking) return;

      if (!booking.cancellationRefund) {
        const error = new ConflictError("not_cancelled", { bookingId });
        return response.status(error.statusCode).json(error.toJSON());
      }

      await issueDocument({
        tenantId,
        bookingIds: [booking.id],
        type: "cancellation",
        options: {
          alreadyPaid: booking.isPayed,
          cancellationReason: booking.rejectionReason,
          refundCalculation: booking.cancellationRefund,
        },
      });

      const updatedBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );

      response
        .status(200)
        .json({ success: true, data: updatedBooking, errors: [] });
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not create cancellation receipt");
    }
  }

  static async getInvoice(request, response) {
    const {
      params: { tenant, id: bookingId, invoiceId },
      user,
    } = request;

    try {
      if (!tenant || !bookingId || !invoiceId) {
        logger.warn(`${tenant} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      // The booking within the reach of the request; none there is a 404.
      const booking = await BookingManager.getBooking(
        bookingId,
        tenant,
        scopeOf(request),
      );
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId });
        return response.status(error.statusCode).json(error.toJSON());
      }

      const invoice = await InvoiceService.getInvoice(
        tenant,
        invoiceId,
        bookingId,
      );

      logger.info(
        `${tenant} -- sending invoice ${invoiceId} to user ${user?.id}`,
      );
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename=${invoiceId}`,
      );

      return response.status(200).send(invoice);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get invoice");
    }
  }

  /**
   * Admin endpoint to manually create an invoice for a booking.
   * Used when the invoice app has manualCreation enabled.
   */
  static async createInvoice(request, response) {
    try {
      const {
        params: { tenant: tenantId, id: bookingId },
        query: { sendEmail },
      } = request;

      const shouldSendEmail = sendEmail !== "false";

      if (!tenantId || !bookingId) {
        logger.warn(`${tenantId} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const invoiceApp = await TenantManager.getTenantApp(tenantId, "invoice");
      if (!invoiceApp || !invoiceApp.active) {
        return response
          .status(400)
          .send({ message: "Invoice app not found or inactive." });
      }

      const booking = await BookingManager.getBooking(bookingId, tenantId);
      if (!booking) {
        return response.status(404).send({ message: "Booking not found." });
      }

      const {
        attachment: { name, invoiceId, revision },
        file,
      } = await issueDocument({
        tenantId,
        bookingIds: [booking.id],
        type: "invoice",
      });

      if (shouldSendEmail) {
        try {
          await mailService.notify("INVOICE", {
            tenantId,
            bookingIds: [booking.id],
            attachments: [file],
          });
        } catch (err) {
          logger.error("Error while sending invoice:", bookingId, err);
        }
      }

      const updatedBooking = await BookingManager.getBooking(
        bookingId,
        tenantId,
      );

      response.status(200).json({
        success: true,
        data: updatedBooking,
        invoice: { name, invoiceId, revision },
        emailSent: shouldSendEmail,
      });
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not create invoice");
    }
  }

  static async getCancellationReceipt(request, response) {
    const {
      params: { tenant, id: bookingId, cancellationReceiptId },
      user,
    } = request;

    try {
      if (!tenant || !bookingId || !cancellationReceiptId) {
        logger.warn(`${tenant} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      // The booking within the reach of the request; none there is a 404.
      const booking = await BookingManager.getBooking(
        bookingId,
        tenant,
        scopeOf(request),
      );
      if (!booking) {
        const error = new NotFoundError("booking_not_found", { bookingId });
        return response.status(error.statusCode).json(error.toJSON());
      }

      const cancellationReceipt =
        await CancellationReceiptService.getCancellation(
          tenant,
          cancellationReceiptId,
          bookingId,
        );

      logger.info(
        `${tenant} -- sending cancellation receipt ${cancellationReceiptId} to user ${user?.id}`,
      );
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename=${cancellationReceiptId}`,
      );

      return response.status(200).send(cancellationReceipt);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get cancellation receipt");
    }
  }

  static async getPublicBookingStatus(request, response) {
    const {
      params: { tenant, id },
      query: { lastname },
    } = request;

    if (!tenant || !id || !lastname) {
      logger.warn(`${tenant} -- Missing required parameters.`);
      return response.status(400).send("Missing required parameters.");
    }

    try {
      const status = await BookingService.checkBookingStatus(
        id,
        lastname,
        tenant,
      );

      logger.info(`${tenant} -- sending public booking status to user`);
      return response.status(200).send(status);
    } catch (err) {
      logger.error(err);
      return response
        .status(err.code || 500)
        .send("Could not get public booking status");
    }
  }

  static async verifyBookingOwnership(request, response) {
    const {
      params: { tenant, id },
      query: { name },
    } = request;

    if (!tenant || !id || !name) {
      logger.warn(`${tenant} -- Missing required parameters.`);
      return response.status(400).send("Missing required parameters.");
    }

    try {
      const status = await BookingService.verifyBookingOwnership(
        tenant,
        id,
        name,
      );

      logger.info(`${tenant} -- sending booking ownership status to user`);
      if (status === true) {
        return response.sendStatus(200);
      } else {
        return response.sendStatus(401);
      }
    } catch (err) {
      logger.error(err);
      return response
        .status(err.code || 500)
        .send("Could not check booking ownership");
    }
  }
}

module.exports = { BookingController };
