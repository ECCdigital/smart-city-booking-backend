const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const MailController = require("../../mail-service/mail-controller");
const { v4: uuidV4 } = require("uuid");
const { getTenant } = require("../../data-managers/tenant-manager");
const {
  BundleCheckoutService,
  ManualBundleCheckoutService,
} = require("./bundle-checkout-service");
const {generateReceipt} = require("../../pdf-service/pdf-service");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});
class BookingService {
  /**
   * This is a static asynchronous method that creates a booking.
   *
   * @param {Object} request - The request object from the client.
   * @param {Boolean}  manualBooking - The manual booking object.
   *
   * @returns {Object} booking - The booking object that was created.
   *
   * @throws {Error} Will throw an error if the bookableItems array is empty or not provided.
   */
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

    let bundleCheckoutService;

    if (manualBooking) {
      bundleCheckoutService = new ManualBundleCheckoutService(
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
        Number(request.body.priceEur),
        Boolean(request.body.isCommitted),
        Boolean(request.body.isPayed),
      );

    } else {
      bundleCheckoutService = new BundleCheckoutService(
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
      );
    }

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
        let attachments = [];
        try {
          if (booking.priceEur > 0) {
            const pdfData = await generateReceipt(
              booking.id,
              tenantId,
            );
            attachments = [
              {
                filename: pdfData.name,
                content: pdfData.buffer,
                contentType: "application/pdf",
              },
            ];
            await FileManager.createFile(
              tenantId,
              pdfData.buffer,
              pdfData.name,
              "public",
              "receipts",
            );
          }
        } catch (err) {
          logger.error(err);
        }

        try {
          await MailController.sendBookingConfirmation(
            booking.mail,
            booking.id,
            booking.tenant,
            attachments,
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
