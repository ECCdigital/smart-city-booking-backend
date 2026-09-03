const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  Booking,
  BOOKING_HOOK_TYPES,
} = require("../../../commons/entities/booking/booking");
const { RolePermission } = require("../../../commons/entities/role/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");
const ReceiptService = require("../../../commons/services/payment/receipt-service");
const InvoiceService = require("../../../commons/services/payment/invoice-service");
const {
  issue: issueDocument,
  mailAttachments,
} = require("../../../commons/services/documents/document-issuance");
const {
  BaseError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");
const BookingService = require("../../../commons/services/checkout/booking-service");
const {
  TRIGGER,
  LifecycleError,
} = require("../../../commons/services/booking-lifecycle");
const {
  CheckoutPolicy,
} = require("../../../commons/services/checkout/checkout-policy");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const PermissionsService = require("../../../commons/services/permission-service");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");
const {
  resolveCheckoutId,
} = require("../../../commons/utilities/checkout-utils");
const CancellationReceiptService = require("../../../commons/services/payment/cancellation-service");
const MailController = require("../../../commons/mail-service/mail-controller");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
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
   * Get all bookings. If public-flag ist set, then all bookings can be received. Otherwise only bookings, the user is
   * allowed to read.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBookings(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const bookings = await BookingManager.getTenantBookings(tenant);

      if (request.query.public === "true") {
        const anonymizedBookings = bookings.map((b) => {
          return BookingController.anonymizeBooking(b);
        });

        logger.info(
          `${tenant} -- sending ${anonymizedBookings.length} anonymized bookings to user ${user?.id}`,
        );
        response.status(200).send(anonymizedBookings);
      } else if (user) {
        const readContext = await PermissionsService.createReadContext(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

        const allowedBookings = PermissionsService.canReadAllWithContext(
          readContext,
        )
          ? bookings
          : bookings.filter((booking) =>
              PermissionsService.allowReadWithContext(booking, readContext),
            );

        if (request.query.populate === "true") {
          await BookingController._populate(allowedBookings);
        }

        logger.info(
          `${tenant} -- sending ${allowedBookings.length} allowed bookings to user ${user?.id}`,
        );
        response.status(200).send(allowedBookings);
      } else {
        logger.warn(
          `${tenant} -- could not get bookings. User is not authenticated`,
        );
        response.sendStatus(403);
      }
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
        userID: user.id,
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
   * IMPORTANT: User needs readAny-Permission to access this endpoint without public-flag.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getRelatedBookings(request, response) {
    try {
      const tenant = request.params.tenant;
      const bookableId = request.params.id;

      const includeRelatedBookings = request.query.related === "true";
      const includeParentBookings = request.query.parent === "true";

      let bookings = await BookingManager.getRelatedBookings(
        tenant,
        bookableId,
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
          );
          parentBookings = parentBookings.concat(bookingsForParent || []);
        }
        bookings = bookings.concat(parentBookings);
      }

      bookings = Array.from(
        new Map(bookings.map((booking) => [booking.id, booking])).values(),
      );

      if (request.query.public === "true") {
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
        const user = await authenticateIfNeeded(request, true);

        if (user) {
          const hasPermission = await UserManager.hasPermission(
            user.id,
            tenant,
            RolePermission.MANAGE_BOOKINGS,
            "readAny",
          );

          if (hasPermission) {
            response.status(200).send(bookings);
          } else {
            response.sendStatus(403);
          }
        } else {
          response.sendStatus(403);
        }
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
        const booking = await BookingManager.getBooking(id, tenantId);

        const hasPermission =
          (await UserManager.hasPermission(
            user.id,
            tenantId,
            RolePermission.MANAGE_BOOKINGS,
            "readAny",
          )) || PermissionsService._isOwner(booking, user.id, tenantId);

        if (hasPermission) {
          await BookingController._populate([booking]);
          logger.info(
            `${tenantId} -- sending booking ${id} to user ${user?.id}`,
          );
          response.status(200).send(booking);
        } else {
          logger.warn(
            `${tenantId} -- could not get booking. User ${user?.id} is not authenticated`,
          );
          response.sendStatus(403);
        }
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

      console.log(ids);

      if (ids) {
        const splitIds = ids.split(",");

        const bookingsStatus = await BookingManager.getBookingStatus(
          tenantId,
          splitIds,
        );

        for (const id of splitIds) {
          const tmp = await BookingService.getBookingStatus(tenantId, splitIds);
        }

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

    if (
      !(await PermissionsService._allowCreate(
        booking,
        user.id,
        booking.tenantId,
        RolePermission.MANAGE_BOOKINGS,
      ))
    ) {
      logger.warn(
        `${booking.tenantId} -- User ${user?.id} is not allowed to create booking.`,
      );
      return response.sendStatus(403);
    }

    const { checkoutId } = await resolveCheckoutId(
      undefined,
      booking.mail,
      tenantId,
    );

    try {
      const newBooking = await BookingService.createSingleBooking({
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

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        const savedBooking = await BookingService.updateBooking(
          tenant,
          booking,
          { requestBody: request.body },
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
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to update booking.`,
        );
        response.sendStatus(403);
      }
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

        if (
          await PermissionsService._allowDelete(
            booking,
            user.id,
            tenant,
            RolePermission.MANAGE_BOOKINGS,
          )
        ) {
          await BookingService.cancelBooking(tenant, id);
          await WorkflowService.removeTask(tenant, id);
          logger.info(`${tenant} -- removed booking ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to remove booking.`,
          );
          response.sendStatus(403);
        }
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

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        logger.info(
          `${tenant} -- committed booking ${booking.id} by user ${user?.id}`,
        );
        const result = await BookingService.commitBooking(tenant, booking, {
          trigger: TRIGGER.ADMIN,
        });

        // The consistency check in front of the transition keeps its
        // answer; the transition itself throws or succeeds.
        if (!result.success) {
          return response.status(200).json({
            success: false,
            data: null,
            errors: result.errors,
          });
        }

        return response.status(200).json({
          success: true,
          data: null,
          errors: [],
        });
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to commit booking.`,
        );
        return response.sendStatus(403);
      }
    } catch (err) {
      // An aborted transition is the `booking_commit_failed` of before
      // (spec part 1, 4.3): the code derived from the transition.
      const error =
        err instanceof LifecycleError
          ? new BaseError("booking_commit_failed", {
              message: `Error committing booking: ${err.message}`,
            })
          : err;
      logger.error(error);
      if (response.headersSent) {
        return;
      }
      // The lifecycle's guard: not a request any more, or a second
      // confirmation that raced this one (409), or no such booking (404).
      if (error instanceof BaseError && error.statusCode < 500) {
        return response.status(error.statusCode).json(error.toJSON());
      }
      response.status(500).send("Could not commit booking");
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

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        logger.info(
          `${tenant} -- setting booking ${booking.id} as paid by user ${user?.id}`,
        );
        await BookingService.setBookingPayed({
          tenantId: tenant,
          bookingId: id,
          trigger: TRIGGER.ADMIN,
          paymentMethod,
          timePaid,
        });
        return response.status(200).send({
          success: true,
          data: null,
          errors: [],
        });
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to set booking as paid.`,
        );
        return response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      if (response.headersSent) {
        return;
      }
      // The lifecycle's guard: not awaiting payment, or a second payment
      // that raced this one (409), or no such booking (404).
      if (err instanceof BaseError && err.statusCode < 500) {
        return response.status(err.statusCode).json(err.toJSON());
      }
      response.status(500).send("Could not set booking as paid");
    }
  }

  static async getCancellationRefundPreview(request, response) {
    try {
      const tenantId = request.params.tenant;
      const bookingId = request.params.id;
      const user = request.user;
      const booking = await BookingManager.getBooking(bookingId, tenantId);

      if (!booking) {
        return response.sendStatus(404);
      }

      const hasPermission = await PermissionsService._allowUpdate(
        booking,
        user.id,
        tenantId,
        RolePermission.MANAGE_BOOKINGS,
      );
      if (!hasPermission) {
        return response.sendStatus(403);
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

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        logger.info(
          `${tenantId} -- rejected booking ${booking.id} by user ${user?.id}`,
        );
        await BookingService.rejectBooking(
          tenantId,
          id,
          reason,
          null,
          false,
          Boolean(skipCancellation),
          bankDetails || null,
          {
            origin: CANCELLATION_ORIGINS.ADMIN,
            refundPercentage,
            cancelledByUserId: user.id,
          },
        );
        return response.sendStatus(200);
      } else {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to reject booking.`,
        );
        return response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not reject booking");
      }
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
      const reason = payload.reason ?? request.body?.reason ?? "";
      const bankDetails = payload.bankDetails ?? null;

      await BookingService.requestRejectBooking(tenant, id, {
        reason,
        bankDetails,
      });

      response.sendStatus(201);
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        if (err && typeof err.statusCode === "number") {
          return response
            .status(err.statusCode)
            .send({ code: err.code, message: err.message });
        }
        response.status(500).send("Could not reject booking");
      }
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

      if (!booking.hooks || booking.hooks.length === 0) {
        return response.sendStatus(404);
      }

      const hook = booking.hooks.find((h) => h.id === hookId);
      if (hook) {
        if (hook.type === BOOKING_HOOK_TYPES.REJECT) {
          const { reason, bankDetails } = hook.payload || {};
          await BookingService.rejectBooking(
            tenant,
            id,
            reason,
            hookId,
            false,
            false,
            bankDetails || null,
            { origin: CANCELLATION_ORIGINS.USER },
          );
        } else {
          return response.sendStatus(400);
        }
      } else {
        return response.sendStatus(404);
      }

      response.sendStatus(200);
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not reject booking");
      }
    }
  }

  static async getEventBookings(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const eventId = request.params.id;

      const bookables = await BookableManager.getBookables(tenantId);
      const eventTickets = bookables.filter(
        (b) => b.type === "ticket" && b.eventId === eventId,
      );

      const bookings = await BookingManager.getTenantBookings(tenantId);
      const eventBookings = bookings.filter((b) =>
        b.bookableIds.some((id) => eventTickets.some((t) => t.id === id)),
      );

      const allowedBookings = [];
      for (const booking of eventBookings) {
        if (
          user &&
          (await PermissionsService._allowRead(
            booking,
            user.id,
            tenantId,
            RolePermission.MANAGE_BOOKINGS,
          ))
        ) {
          allowedBookings.push(booking);
        }
      }

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

      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hasPermission =
        (await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny",
        )) ||
        PermissionsService._isOwner(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

      if (!hasPermission) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to get receipt.`,
        );
        return response.sendStatus(403);
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
   * The booking a reprint is asked for, once the request may have it: the
   * booking exists (else 404) and the user manages bookings or owns it
   * (else 403). Answers the request itself and returns null where not.
   */
  static async _reprintable(request, response, what) {
    const {
      params: { tenant: tenantId, id: bookingId },
      user,
    } = request;

    const booking = await BookingManager.getBooking(bookingId, tenantId);
    if (!booking) {
      response.status(404).send({ message: "Booking not found." });
      return null;
    }

    const hasPermission =
      (await UserManager.hasPermission(
        user.id,
        tenantId,
        RolePermission.MANAGE_BOOKINGS,
        "updateAny",
      )) || PermissionsService._isOwner(booking, user.id, tenantId);

    if (!hasPermission) {
      logger.warn(
        `${tenantId} -- User ${user?.id} is not allowed to create ${what}.`,
      );
      response.sendStatus(403);
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

      const booking = await BookingController._reprintable(
        request,
        response,
        "receipt",
      );
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

      const booking = await BookingController._reprintable(
        request,
        response,
        "cancellation receipt",
      );
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

      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hasPermission =
        (await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny",
        )) ||
        PermissionsService._isOwner(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

      if (!hasPermission) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to get invoice.`,
        );
        return response.sendStatus(403);
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
        user,
      } = request;

      const shouldSendEmail = sendEmail !== "false";

      if (!tenantId || !bookingId) {
        logger.warn(`${tenantId} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const hasPermission = await UserManager.hasPermission(
        user.id,
        tenantId,
        RolePermission.MANAGE_BOOKINGS,
        "updateAny",
      );

      if (!hasPermission) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to create invoice.`,
        );
        return response.sendStatus(403);
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
          await MailController.sendInvoice(
            booking.mail,
            bookingId,
            tenantId,
            mailAttachments(file),
          );
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

      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hasPermission =
        (await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny",
        )) ||
        PermissionsService._isOwner(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

      if (!hasPermission) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to get cancellation receipt.`,
        );
        return response.sendStatus(403);
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
