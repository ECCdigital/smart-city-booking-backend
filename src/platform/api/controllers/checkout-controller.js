const {
  ItemCheckoutService,
  CheckoutPermissions,
} = require("../../../commons/services/checkout/item-checkout-service");
const bunyan = require("bunyan");
const BookingService = require("../../../commons/services/checkout/booking-service");
const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutController {
  static async validateItem(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const { bookableId, timeBegin, timeEnd, amount, couponCode } = request.body;

    if (!bookableId || !amount) {
      logger.warn(
        `${tenantId} -- could not validate item by user ${user?.id}. Missing parameters.`,
      );
      return response.status(400).send("Missing parameters");
    }

    //TODO: Move this to a service

    const itemCheckoutService = new ItemCheckoutService(
      user?.id,
      tenantId,
      timeBegin,
      timeEnd,
      bookableId,
      parseInt(amount),
      couponCode,
    );

    await itemCheckoutService.init();

    try {
      await itemCheckoutService.checkAll();
      logger.info(
        `${tenantId} -- validated bookable ${bookableId} for user ${user?.id} with amount ${amount} and time ${timeBegin} - ${timeEnd}`,
      );

      let multiplier = parseInt(amount);
      if (itemCheckoutService.ignoreAmount) {
        multiplier = 1;
      }

      const payload = {
        regularPriceEur:
          (await itemCheckoutService.regularPriceEur()) * multiplier,
        userPriceEur: (await itemCheckoutService.userPriceEur()) * multiplier,
        regularGrossPriceEur:
          (await itemCheckoutService.regularGrossPriceEur()) * multiplier,
        userGrossPriceEur:
          (await itemCheckoutService.userGrossPriceEur()) * multiplier,
      };

      return response.status(200).json(payload);
    } catch (err) {
      logger.warn(err);
      return response.status(409).send(err.message);
    }
  }

  static async checkout(request, response) {
    try {
      return response
        .status(200)
        .send(await BookingService.createBooking(request));
    } catch (err) {
      logger.error(err);
      response.status(err.cause?.code === 400 ? 400 : 409).send(err.message);
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
