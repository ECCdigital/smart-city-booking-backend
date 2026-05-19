const {
  ItemCheckoutService,
  CheckoutPermissions,
} = require("../../../../commons/services/checkout/item-checkout-service");
const BookingService = require("../../../../commons/services/checkout/booking-service");
const {
  BookableManager,
} = require("../../../../commons/data-managers/bookable-manager");
const MembershipManager = require("../../../../commons/data-managers/membership-manager");
const {
  resolveCheckoutId,
} = require("../../../../commons/utilities/checkout-utils");
const {
  normalizeCheckError,
} = require("../../../../commons/services/checkout/normalize-check-error");
const {
  CHECKOUT_REASONS,
} = require("../../../../commons/services/checkout/checkout-reasons");
const { CheckoutError } = require("../../../../errors/CheckoutError");
const { BaseError } = require("../../../../errors/BaseError");
const PaymentUtils = require("../../../../commons/utilities/payment-utils");
const LockerService = require("../../../../commons/services/locker/locker-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "checkout-controller.v2.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutControllerV2 {
  /**
   * Validate a single item.
   * Always responds with HTTP 200.
   * Body shape:
   *   success: true  -> { success, checkoutId, checkoutIdGenerated, data }
   *   success: false -> { success, checkoutId, checkoutIdGenerated, error }
   *
   * Stop-on-first-error: returns as soon as any check fails.
   */
  static async validateItem(req, res) {
    const tenantId = req.params.tenant;
    const bookableId = req.params.id;
    const user = req.user;
    const {
      checkoutId: requestCheckoutId,
      start,
      end,
      amount,
      couponCode,
      bookWithPrice,
    } = req.body;


    const { checkoutId, generated } = await resolveCheckoutId(
      requestCheckoutId,
      user?.id,
      tenantId,
    );

    if (!bookableId || !amount) {
      logger.warn(
        { tenantId, userId: user?.id, bookableId, amount },
        "validateItem: missing parameters",
      );
      return res.status(200).json({
        success: false,
        checkoutId,
        checkoutIdGenerated: generated,
        error: {
          reason: CHECKOUT_REASONS.MISSING_PARAMETERS,
          params: {
            missing: {
              bookableId: !bookableId,
              amount: !amount,
            },
          },
        },
      });
    }

    const service = new ItemCheckoutService({
      user: user?.id,
      tenantId,
      timeBegin: start,
      timeEnd: end,
      bookableId,
      amount: parseInt(amount),
      couponCode,
      bookWithPrice,
      checkoutId,
    });

    try {
      await service.init();

      // stop-on-first-error: checkAll(true) uses Promise.all and rejects fast
      try {
        await service.checkAll(true);
      } catch (checkErr) {
        const normalized = normalizeCheckError(checkErr);
        logger.info(
          {
            tenantId,
            bookableId,
            userId: user?.id,
            reason: normalized.reason,
            checkType: normalized.checkType,
            debugMessage: normalized.debugMessage,
          },
          "validateItem: validation failed",
        );

        return res.status(200).json({
          success: false,
          checkoutId,
          checkoutIdGenerated: generated,
          error: {
            reason: normalized.reason,
            checkType: normalized.checkType,
            params: normalized.params,
          },
        });
      }

      // pricing
      let multiplier = parseInt(amount);
      if (service.ignoreAmount) multiplier = 1;

      const data = {
        regularPriceEur: (await service.regularPriceEur()) * multiplier,
        userPriceEur: (await service.userPriceEur()) * multiplier,
        regularGrossPriceEur:
          (await service.regularGrossPriceEur()) * multiplier,
        userGrossPriceEur: (await service.userGrossPriceEur()) * multiplier,
        freeBookingAllowed: await service.freeBookingAllowed(),
      };

      logger.info(
        { tenantId, bookableId, userId: user?.id, amount },
        "validateItem: ok",
      );

      return res.status(200).json({
        success: true,
        checkoutId,
        checkoutIdGenerated: generated,
        data,
      });
    } catch (err) {
      // unexpected (DB/network/etc.) — surface as graceful failure too,
      // because we promised "always 200" for this endpoint.
      logger.error(
        { err, tenantId, bookableId, userId: user?.id },
        "validateItem: unexpected error",
      );

      return res.status(200).json({
        success: false,
        checkoutId,
        checkoutIdGenerated: generated,
        error: {
          reason: CHECKOUT_REASONS.UNKNOWN,
          checkType: null,
          params: {},
        },
      });
    } finally {
      service.cleanup();
    }
  }

  /**
   * Single checkout. Creates the booking and — when the booking is already
   * committed, still unpaid and has a price > 0 — directly triggers the
   * payment provider. The response always contains the booking and, if
   * applicable, the payment data the frontend needs to redirect/handle.
   *
   * Throws CheckoutError on business failures → handled by the global
   * errorHandler middleware.
   */
  static async checkout(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const simulate = req.query.simulate === "true";
      const { checkoutId: requestCheckoutId } = req.body;

      const { checkoutId } = await resolveCheckoutId(
        requestCheckoutId,
        user?.id,
        tenantId,
      );

      const booking = await BookingService.createSingleBooking({
        tenantId,
        user,
        bookingAttempt: req.body,
        simulate,
        checkoutId,
      });

      if (simulate || !CheckoutControllerV2._needsPayment(booking)) {
        return res.status(200).json({
          success: true,
          data: { booking, payment: null },
        });
      }

      const payment = await CheckoutControllerV2._initiatePayment({
        tenantId,
        booking,
      });

      return res.status(200).json({
        success: true,
        data: { booking, payment },
      });
    } catch (err) {
      return CheckoutControllerV2._respondWithError(res, err, {
        logMessage: "checkout: failed",
        context: {
          tenantId: req.params.tenant,
          userId: req.user?.id,
        },
      });
    }
  }

  static async groupCheckout(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const simulate = req.query.simulate === "true";

      const bookingAttempts = Array.isArray(req.body.bookingAttempts)
        ? req.body.bookingAttempts
        : [];

      if (bookingAttempts.length === 0) {
        throw new CheckoutError({
          reason: CHECKOUT_REASONS.BOOKING_ATTEMPTS_MISSING,
          statusCode: 400,
        });
      }

      const lead = bookingAttempts[0];
      const bookableItem = lead.bookableItems?.[0]?.bookable;
      if (!bookableItem?.id) {
        throw new CheckoutError({
          reason: CHECKOUT_REASONS.INVALID_BOOKABLE_ITEMS,
          statusCode: 400,
        });
      }

      const bookable = await BookableManager.getBookable(bookableItem.id, tenantId);
      const gb = bookable?.groupBooking;
      if (!gb?.enabled) {
        throw new CheckoutError({
          reason: CHECKOUT_REASONS.GROUP_BOOKING_DISABLED,
          statusCode: 403,
          params: { bookableId: bookableItem.id },
        });
      }

      const permitted = Array.isArray(gb.permittedRoles) ? gb.permittedRoles : [];
      if (permitted.length > 0) {
        if (!user) {
          throw new CheckoutError({
            reason: CHECKOUT_REASONS.UNAUTHORIZED,
            statusCode: 401,
          });
        }

        const membership = await MembershipManager.getMembershipByTenantAndUserID(
          tenantId,
          user.id,
        );
        const userRoles = membership?.roles || [];
        const allowed = userRoles.some((r) => permitted.includes(r));

        if (!allowed) {
          throw new CheckoutError({
            reason: CHECKOUT_REASONS.GROUP_BOOKING_ROLE_REQUIRED,
            statusCode: 403,
            params: { requiredRoles: permitted },
          });
        }
      }

      const groupBooking = await BookingService.createGroupBooking({
        tenantId,
        user,
        contactData: req.body.contactData,
        bookingAttempts,
        paymentProvider: req.body.paymentProvider,
        simulate,
      });
      return res.status(200).json({ success: true, data: groupBooking });
    } catch (err) {
      return CheckoutControllerV2._respondWithError(res, err, {
        logMessage: "groupCheckout: failed",
        context: {
          tenantId: req.params.tenant,
          userId: req.user?.id,
        },
      });
    }
  }

  static async checkoutPermissions(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const id = req.params.id;

      console.log("checkoutPermissions", {tenantId, user, id});

      const bookable = await BookableManager.getBookable(id, tenantId);

      if (!bookable) {
        throw new CheckoutError({
          reason: CHECKOUT_REASONS.BOOKABLE_NOT_FOUND,
          statusCode: 404,
          params: { bookableId: id },
          checkType: "permissions",
        });
      }

      if (bookable.requiresLogin && !user) {
        throw new CheckoutError({
          reason: CHECKOUT_REASONS.LOGIN_REQUIRED,
          statusCode: 401,
          checkType: "permissions",
        });
      }

      const requiresPermissionCheck =
        bookable.permittedUsers.length > 0 ||
        bookable.permittedRoles.length > 0;

      if (requiresPermissionCheck) {
        if (!user) {
          throw new CheckoutError({
            reason: CHECKOUT_REASONS.UNAUTHORIZED,
            statusCode: 401,
            checkType: "permissions",
          });
        }
        const allowed = await CheckoutPermissions._allowCheckout(
          bookable,
          user.id,
          tenantId,
        );
        if (!allowed) {
          throw new CheckoutError({
            reason: CHECKOUT_REASONS.PERMISSION_DENIED,
            statusCode: 403,
            checkType: "permissions",
          });
        }
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return CheckoutControllerV2._respondWithError(res, err, {
        logMessage: "checkoutPermissions: failed",
        context: {
          tenantId: req.params.tenant,
          userId: req.user?.id,
          bookableId: req.params.id,
        },
      });
    }
  }

  // --- helpers ---

  /**
   * Determines whether the booking still needs to go through the payment
   * provider. Mirrors the pre-checks the frontend used to perform before
   * calling `PaymentController.createPayment`.
   */
  static _needsPayment(booking) {
    if (!booking) return false;
    if (!booking.isCommitted) return false;
    if (booking.isPayed) return false;
    if (!booking.priceEur || booking.priceEur === 0) return false;
    return true;
  }

  /**
   * Triggers the payment provider for a single booking. Replicates the
   * relevant parts of `PaymentController.createPayment` so the frontend
   * no longer has to make a second request after checkout.
   */
  static async _initiatePayment({ tenantId, booking }) {
    const bookingIds = [booking.id];

    try {
      const lockerServiceInstance = LockerService.getInstance();
      await lockerServiceInstance.refreshPreReservations(tenantId, bookingIds);
    } catch (err) {
      logger.warn(
        { tenantId, bookingId: booking.id, err: err.message },
        "checkout: locker pre-reservation refresh failed",
      );
      throw new CheckoutError({
        reason: CHECKOUT_REASONS.LOCKER_UNAVAILABLE,
        statusCode: 409,
        params: { message: err.message },
      });
    }

    let paymentService;
    try {
      paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingIds,
        booking.paymentProvider,
        { aggregated: false, groupBookingId: null },
      );
    } catch (err) {
      throw new CheckoutError({
        reason: CHECKOUT_REASONS.PAYMENT_PROVIDER_UNAVAILABLE,
        statusCode: 409,
        params: {
          paymentProvider: booking.paymentProvider,
          message: err.message,
        },
      });
    }

    if (!paymentService) {
      throw new CheckoutError({
        reason: CHECKOUT_REASONS.PAYMENT_PROVIDER_UNAVAILABLE,
        statusCode: 409,
        params: { paymentProvider: booking.paymentProvider },
      });
    }

    try {
      const data = await paymentService.createPayment();
      return {
        provider: booking.paymentProvider,
        data,
      };
    } catch (err) {
      throw new CheckoutError({
        reason: CHECKOUT_REASONS.PAYMENT_FAILED,
        statusCode: 502,
        params: {
          paymentProvider: booking.paymentProvider,
          message: err.message,
        },
      });
    }
  }

  /**
   * Converts arbitrary errors thrown by services/managers into a
   * CheckoutError so the global errorHandler can render a stable JSON
   * shape with a reason code.
   */
  static _toCheckoutError(err) {
    if (err instanceof BaseError) return err;

    // Plain { checkType, message, ... } from ItemCheckoutService
    if (err && typeof err === "object" && err.checkType) {
      const normalized = normalizeCheckError(err);
      return new CheckoutError({
        reason: normalized.reason,
        checkType: normalized.checkType,
        params: normalized.params,
        statusCode: 409,
      });
    }

    // Legacy `{ cause: { code: 400 } }` style
    if (err?.cause?.code === 400) {
      return new CheckoutError({
        reason: CHECKOUT_REASONS.BAD_REQUEST,
        statusCode: 400,
        params: { message: err.message },
      });
    }

    return err;
  }

  static _respondWithError(res, err, { logMessage, context = {} } = {}) {
    const normalized = CheckoutControllerV2._toCheckoutError(err);
    const reason = normalized?.reason || CHECKOUT_REASONS.UNKNOWN;
    const checkType = normalized?.checkType || null;
    const params = normalized?.params || {};

    logger.error(
      { err: normalized, reason, checkType, params, ...context },
      logMessage || "checkout controller error",
    );

    return res.status(200).json({
      success: false,
      error: {
        reason,
        checkType,
        params,
      },
    });
  }
}

module.exports = CheckoutControllerV2;
