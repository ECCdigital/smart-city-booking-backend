const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const MailController = require("../../mail-service/mail-controller");
const { v4: uuidV4 } = require("uuid");
const { getTenant } = require("../../data-managers/tenant-manager");
const BundleCheckoutService = require("./bundle-checkout-service");
const PdfService = require("../../pdf-service/pdf-service");
const pdfService = require("../../pdf-service/pdf-service");
const fs = require("fs");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});
class BookingService {
  static async createBooking(request, manualBooking = false) {
    const checkoutId = uuidV4();
    const tenantId = request.params.tenant;
    const simulate = request.query.simulate === "true";
    const user = request.user;
    const tenant = await getTenant(tenantId);

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
      mail,
      phone,
      comment,
      isCommitted,
      isPayed,
      priceEur,
    } = request.body;

    logger.info(
      `${tenantId}, cid ${checkoutId} -- checkout request by user ${user?.id} with simulate=${simulate}`,
    );
    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Checkout Details: timeBegin=${timeBegin}, timeEnd=${timeEnd}, bookableItems=${bookableItems}, couponCode=${couponCode}, name=${name}, company=${company}, street=${street}, zipCode=${zipCode}, location=${location}, email=${mail}, phone=${phone}, comment=${comment}`,
    );

    if (!bookableItems || bookableItems.length === 0) {
      logger.warn(
        `${tenantId}, cid ${checkoutId} -- checkout stopped. Missing parameters`,
      );

      throw new Error("Missing parameters", { cause: { code: 400 } });
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
      mail,
      phone,
      comment,
      manualBooking ? isCommitted : undefined,
      manualBooking ? isPayed : undefined,
      manualBooking ? priceEur : undefined,
    );

    const booking = await bundleCheckoutService.prepareBooking(manualBooking);
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
          tenant.mail,
          booking.id,
          booking.tenant,
        );
      } catch (err) {
        logger.error(err);
      }
    } else {
      logger.info(`${tenantId}, cid ${checkoutId} -- Simulated booking`);
    }
    return booking;
  }
}

module.exports = BookingService;
