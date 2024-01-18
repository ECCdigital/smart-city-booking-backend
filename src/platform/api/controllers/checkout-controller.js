const ItemCheckoutService = require("../../../commons/services/checkout/item-checkout-service");
const BundleCheckoutService = require("../../../commons/services/checkout/bundle-checkout-service");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const TenantManager = require("../../../commons/data-managers/tenant-manager");

class CheckoutController {
  static async validateItem(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const { bookableId, timeBegin, timeEnd, amount } = request.body;

    if (!bookableId || !amount) {
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
      return response.sendStatus(200);
    } catch (err) {
      console.log(err);
      return response.status(409).send(err.message);
    }
  }

  static async checkout(request, response) {
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

    if (!bookableItems || bookableItems.length === 0) {
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
      if (simulate === false) {
        await BookingManager.storeBooking(booking);

        if (!booking.isCommitted) {
          try {
            await MailController.sendBookingRequestConfirmation(
                booking.mail,
                booking.id,
                booking.tenant
            );
          } catch (err) {
            console.log(err);
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
            console.log(err);
          }
        }

        try {
          await MailController.sendIncomingBooking(
            booking.mail,
            booking.id,
            booking.tenant,
          );
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log("Simulate booking");
      }

      return response.status(200).send(booking);
    } catch (err) {
      return response.status(409).send(err.message);
    }
  }
}

module.exports = CheckoutController;
