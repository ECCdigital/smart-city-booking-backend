const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const TenantManager = require("../data-managers/tenant-manager");
const QRCode = require("qrcode");
const { renderSnippet } = require("./templates/template-loader");
const Formatters = require("../utilities/formatters");

class MailDataService {
  static buildCancellationMailContext(
    booking,
    tenantId,
    addRejectionLink = false,
  ) {
    if (!addRejectionLink || !booking) {
      return { rejectionUrl: null, cancellationContactHint: null };
    }

    const userCancellable =
      booking.cancellationPolicy?.userCancellable === true;

    if (userCancellable) {
      return {
        rejectionUrl: `${process.env.FRONTEND_URL}/booking/request-reject/${tenantId}?id=${booking.id}`,
        cancellationContactHint: null,
      };
    }

    const contactHint = booking.cancellationPolicy?.contactHint?.trim();
    return {
      rejectionUrl: null,
      cancellationContactHint: contactHint || null,
    };
  }

  static async getPopulatedBookables(bookingId, tenant) {
    const booking = await BookingManager.getBooking(bookingId, tenant);
    const bookables = (await BookableManager.getBookables(tenant)).filter((b) =>
      booking.bookableItems.some((bi) => bi.bookableId === b.id),
    );

    for (const bookable of bookables) {
      bookable._populated = {
        event: await EventManager.getEvent(bookable.eventId, bookable.tenantId),
      };
    }

    return bookables;
  }

  static buildBookingItems(booking, bookables) {
    return booking.bookableItems.map((item) => {
      const bookable = bookables.find((b) => b.id === item.bookableId);
      const isTicket =
        bookable.type === "ticket" &&
        bookable.eventId &&
        bookable._populated?.event;

      let eventData = null;
      if (isTicket) {
        const event = bookable._populated.event;
        eventData = {
          name: event.information.name,
          startDate: event.information.startDate,
          startTime: event.information.startTime,
          endDate: event.information.endDate,
          endTime: event.information.endTime,
          locationName: event.eventLocation.name,
          locationStreet: event.location?.address?.street,
          locationHouseNumber: event.location?.address?.house_number,
          locationZip: event.location?.address?.post_code,
          locationCity: event.location?.address?.city,
        };
      }

      return {
        amount: item.amount,
        isTicket,
        bookableTitle: bookable.title,
        bookingNotes: bookable.bookingNotes,
        event: eventData,
      };
    });
  }

  static buildCouponInfo(booking) {
    if (!booking.coupon) return null;
    const { type, description, value } = booking.coupon;
    if (type === "fixed" || type === "percentage") {
      return { description, value, isFixed: type === "fixed" };
    }
    return null;
  }

  static async generateBookingDetails(bookingId, tenantId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    const tenant = await TenantManager.getTenant(tenantId);
    const bookables = await this.getPopulatedBookables(bookingId, tenantId);
    const bookingItems = this.buildBookingItems(booking, bookables);
    const coupon = this.buildCouponInfo(booking);
    const bookingPeriod = Formatters.formatBookingPeriod(
      booking.timeBegin,
      booking.timeEnd,
      tenant.mailBookingPeriodFormat,
    );

    // Order follows the merge order of the definitions (instance → tenant →
    // bookable); a null displayValue renders as "nicht angegeben".
    const mailCustomFields = (booking.customFields || [])
      .filter((field) => field.usageOptions?.showInMail === true)
      .map((field) => ({
        caption: field.caption,
        displayValue:
          field.value === null ||
          field.value === undefined ||
          field.value === ""
            ? null
            : String(field.value),
      }));

    return renderSnippet("booking-details", {
      booking,
      bookingItems,
      coupon,
      bookingPeriod,
      mailCustomFields,
    });
  }

  static async generateShortBookingDetails(
    bookingId,
    tenantId,
    addRejectionLink = false,
  ) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    const tenant = await TenantManager.getTenant(tenantId);
    const bookables = await this.getPopulatedBookables(bookingId, tenantId);

    const bookingItems = booking.bookableItems.map((item) => {
      const bookable = bookables.find((b) => b.id === item.bookableId);
      return { amount: item.amount, bookableTitle: bookable.title };
    });

    const { rejectionUrl, cancellationContactHint } =
      this.buildCancellationMailContext(booking, tenantId, addRejectionLink);
    const bookingPeriod = Formatters.formatBookingPeriod(
      booking.timeBegin,
      booking.timeEnd,
      tenant.mailBookingPeriodFormat,
    );

    return renderSnippet("short-booking-details", {
      booking,
      bookingItems,
      rejectionUrl,
      cancellationContactHint,
      bookingPeriod,
    });
  }

  static async generateAggregatedBookingDetails(
    tenantId,
    bookingIds,
    addRejectionLink,
  ) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);
    const subBookingSnippets = [];
    let totalPriceEur = 0;

    for (const booking of bookings) {
      const html = await this.generateShortBookingDetails(
        booking.id,
        tenantId,
        addRejectionLink,
      );
      subBookingSnippets.push(html);
      totalPriceEur += booking.priceEur;
    }

    return renderSnippet("aggregated-booking-details", {
      totalPrice: totalPriceEur,
      subBookings: subBookingSnippets,
      booking: bookings[0],
    });
  }

  static async generateQRCode(bookingId, tenantId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    const qrUrl = `${process.env.FRONTEND_URL}/booking/status/${tenantId}?id=${booking.id}&name=${encodeURIComponent(booking.name)}`;
    const qrCodeBuffer = await QRCode.toBuffer(qrUrl);

    const attachment = {
      filename: "qrcode.png",
      content: qrCodeBuffer,
      cid: "qrcode_cid",
    };

    const content = renderSnippet("qr-code", { qrUrl });

    return { content, attachment };
  }
}

module.exports = MailDataService;
