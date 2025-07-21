const {
  ItemCheckoutService,
  CheckoutPermissions,
} = require("../../../commons/services/checkout/item-checkout-service");
const bunyan = require("bunyan");
const BookingService = require("../../../commons/services/checkout/booking-service");
const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutController {
  static async validateItem(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const {
      bookableId,
      timeBegin,
      timeEnd,
      amount,
      couponCode,
      bookWithPrice,
    } = request.body;

    if (!bookableId || !amount) {
      logger.warn(
        `${tenantId} -- could not validate item by user ${user?.id}. Missing parameters.`,
      );
      return response.status(400).send("Missing parameters");
    }

    //TODO: Move this to a service

    let itemCheckoutService = null;

    try {
      itemCheckoutService = new ItemCheckoutService(
        user?.id,
        tenantId,
        timeBegin,
        timeEnd,
        bookableId,
        parseInt(amount),
        couponCode,
        bookWithPrice,
      );

      await itemCheckoutService.init();
      await itemCheckoutService.checkAll();
      logger.info(
        `${tenantId} -- validated bookable ${bookableId} for user ${user?.id} with amount ${amount} and time ${timeBegin} - ${timeEnd}`,
      );

      let multiplier = parseInt(amount);
      try {
        if (itemCheckoutService.ignoreAmount) {
          multiplier = 1;
        }
      } catch (err) {
        throw new Error("Es konnte kein Preis ermittelt werden");
      }

      const payload = {
        regularPriceEur:
          (await itemCheckoutService.regularPriceEur()) * multiplier,
        userPriceEur: (await itemCheckoutService.userPriceEur()) * multiplier,
        regularGrossPriceEur:
          (await itemCheckoutService.regularGrossPriceEur()) * multiplier,
        userGrossPriceEur:
          (await itemCheckoutService.userGrossPriceEur()) * multiplier,
        freeBookingAllowed: await itemCheckoutService.freeBookingAllowed(),
      };

      return response.status(200).json(payload);
    } catch (err) {
      console.error(err);
      logger.warn(err);
      return response.status(409).send(err.message);
    } finally {
      if (itemCheckoutService) {
        itemCheckoutService.cleanup();
        itemCheckoutService = null;
      }
    }
  }

  static async checkout(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const simulate = request.query.simulate === "true";
    try {
      return response.status(200).send(
        await BookingService.createSingleBooking({
          tenantId,
          user,
          bookingAttempt: request.body,
          simulate,
        }),
      );
    } catch (err) {
      logger.error(err);
      response.status(err.cause?.code === 400 ? 400 : 409).send(err.message);
    }
  }

  static async groupCheckout(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;
    const simulate = req.query.simulate === "true";

    const bookingAttempts = Array.isArray(req.body.bookingAttempts)
      ? req.body.bookingAttempts
      : [];
    if (bookingAttempts.length === 0) {
      return res.status(400).send("bookingAttempts missing or empty");
    }

    const lead = bookingAttempts[0];
    const bookableItem = lead.bookableItems?.[0]?.bookable;
    if (!bookableItem?.id) {
      return res.status(400).send("Invalid bookableItems");
    }

    let bookable;
    try {
      bookable = await BookableManager.getBookable(bookableItem.id, tenantId);
    } catch (err) {
      logger.error(
        `Error while loading ${bookableItem.id} for tenant ${tenantId}:`,
        err,
      );
      return res.status(404).send("Bookable not found");
    }

    const gb = bookable.groupBooking;
    if (!gb?.enabled) {
      return res
        .status(403)
        .send("Group booking not enabled for this bookable");
    }

    let allowed = false;
    const permitted = Array.isArray(gb.permittedRoles) ? gb.permittedRoles : [];

    if (permitted.length === 0) {
      allowed = true;
    } else {
      if (!user) {
        return res.status(401).send("Unauthorized");
      }
      let userRoles;
      try {
        userRoles = await TenantManager.getTenantUserRoles(tenantId, user.id);
      } catch (err) {
        logger.error(
          `Error while loading user roles for tenant ${tenantId}:`,
          err,
        );
        return res.status(500).send("Error while loading user roles");
      }
      allowed = userRoles.some((r) => permitted.includes(r));
    }

    if (!allowed) {
      logger.error(
        `User ${user?.id} not allowed to create group booking for bookable ${bookableItem.id}`,
      );
      return res.status(403).send("User not allowed to create group booking");
    }

    try {
      const groupBooking = await BookingService.createGroupBooking({
        tenantId,
        user,
        contactData: req.body.contactData,
        bookingAttempts,
        paymentProvider: req.body.paymentProvider,
        simulate,
      });
      return res.status(200).json(groupBooking);
    } catch (err) {
      logger.error(
        `Error while creating group booking for tenant ${tenantId}:`,
        err,
      );
      const status = err.cause?.code === 400 ? 400 : 409;
      return res.status(status).send(err.message);
    }
  }

  static async checkoutPermissions(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      const bookable = await BookableManager.getBookable(id, tenantId);

      if (!bookable) {
        return response.status(404).send("Bookable not found");
      }

      if (
        bookable.permittedUsers.length > 0 ||
        bookable.permittedRoles.length > 0
      ) {
        if (!user) {
          return response.status(401).send("Unauthorized");
        }
        if (
          !(await CheckoutPermissions._allowCheckout(
            bookable,
            user.id,
            tenantId,
          ))
        ) {
          return response.status(403).send("Forbidden");
        }
      }

      return response.status(200).send("OK");
    } catch (err) {
      logger.error(err);
      response.status(500).send("Internal server error");
    }
  }
}

module.exports = CheckoutController;
