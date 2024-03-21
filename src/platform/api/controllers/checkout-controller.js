const ItemCheckoutService = require("../../../commons/services/checkout/item-checkout-service");
const bunyan = require("bunyan");
const {
  createBooking,
} = require("../../../commons/services/checkout/booking-service");
const pdfService = require("../../../commons/pdf-service/pdf-service");
const IdGenerator = require("../../../commons/utilities/id-generator");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const FileManager = require("../../../commons/data-managers/file-manager");

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

    const itemCheckoutService = new ItemCheckoutService(
      user,
      tenantId,
      timeBegin,
      timeEnd,
      bookableId,
      parseInt(amount),
      couponCode,
    );

    try {
      await itemCheckoutService.checkAll();
      logger.info(
        `${tenantId} -- validated bookable ${bookableId} for user ${user?.id} with amount ${amount} and time ${timeBegin} - ${timeEnd}`,
      );
      return response.status(200).json({
        regularPriceEur: await itemCheckoutService.regularPriceEur(),
        userPriceEur: await itemCheckoutService.userPriceEur(),
      });
    } catch (err) {
      logger.warn(err);
      return response.status(409).send(err.message);
    }
  }

  static async checkout(request, response, manualBooking = false) {
    try {
      return response
        .status(200)
        .send(await createBooking(request, manualBooking));
    } catch (err) {
      logger.error(err);
      response.status(err.cause?.code === 400 ? 400 : 409).send(err.message);
    }
  }
}

module.exports = CheckoutController;
