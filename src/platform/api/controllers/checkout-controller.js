const ItemCheckoutService = require("../../../commons/services/checkout/item-checkout-service");
const BundleCheckoutService = require("../../../commons/services/checkout/bundle-checkout-service");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const bunyan = require("bunyan");
const { v4: uuidV4 } = require("uuid");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});

class CheckoutController {
  static async validateItem(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const { bookableId, timeBegin, timeEnd, amount } = request.body;

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
    );

    try {
      await itemCheckoutService.checkAll();
      logger.info(
        `${tenantId} -- validated bookable ${bookableId} for user ${user?.id} with amount ${amount} and time ${timeBegin} - ${timeEnd}`,
      );
      return response.sendStatus(200);
    } catch (err) {
      logger.warn(err);
      return response.status(409).send(err.message);
    }
  }

  static async checkout(request, response) {
    const checkoutId = uuidV4();
    const tenantId = request.params.tenant;
    const simulate = request.query.simulate === "true";
    const user = request.user;
    const tenant = await TenantManager.getTenant(tenantId);

    const {
      timeBegin,
      timeEnd,
      bookableItems,
      couponCode,
      name,
      company,
      street,
      zipCode,
      location,
      email,
      phone,
      comment,
    } = request.body;

    logger.info(
      `${tenantId}, cid ${checkoutId} -- checkout request by user ${user?.id} with simulate=${simulate}`,
    );
    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Checkout Details: timeBegin=${timeBegin}, timeEnd=${timeEnd}, bookableItems=${bookableItems}, couponCode=${couponCode}, name=${name}, company=${company}, street=${street}, zipCode=${zipCode}, location=${location}, email=${email}, phone=${phone}, comment=${comment}`,
    );

    if (!bookableItems || bookableItems.length === 0) {
      logger.warn(
        `${tenantId}, cid ${checkoutId} -- checkout stopped. Missing parameters`,
      );
      return response.status(400).send("Missing parameters");
    }

    const bundleCheckoutService = new BundleCheckoutService(
      user,
      tenantId,
      timeBegin,
      timeEnd,
      bookableItems,
      couponCode,
      name,
      company,
      street,
      zipCode,
      location,
      email,
      phone,
      comment,
    );

    try {
      const booking = await bundleCheckoutService.prepareBooking();
      logger.debug(
        `${tenantId}, cid ${checkoutId} -- Booking prepared: ${JSON.stringify(
          booking,
        )}`,
      );
      if (simulate === false) {
        await BookingManager.storeBooking(booking);

        logger.info(
          `${tenantId}, cid ${checkoutId} -- Booking ${booking.id} stored by user ${user?.id}`,
        );

        if (!booking.isCommitted) {
          try {
            await MailController.sendBookingRequestConfirmation(
              booking.mail,
              booking.id,
              booking.tenant,
            );
          } catch (err) {
            logger.error(err);
          }
        }
        if (booking.isCommitted && booking.isPayed) {
          try {
            await MailController.sendBookingConfirmation(
              booking.mail,
              booking.id,
              booking.tenant,
            );
          } catch (err) {
            logger.error(err);
          }
        }

        try {
          await MailController.sendIncomingBooking(
            booking.mail,
            booking.id,
            booking.tenant,
          );
        } catch (err) {
          logger.error(err);
        }
      } else {
        logger.info(`${tenantId}, cid ${checkoutId} -- Simulated booking`);
      }

      return response.status(200).send(booking);
    } catch (err) {
      logger.error(err);
      return response.status(409).send(err.message);
    }
  }
}

module.exports = CheckoutController;
