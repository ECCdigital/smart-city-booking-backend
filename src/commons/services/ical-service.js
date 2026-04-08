const ical = require("ical-generator").default || require("ical-generator");
const EventManager = require("../data-managers/event-manager");
const TenantManager = require("../data-managers/tenant-manager");
const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");

class ICalService {
  static async getEventCal(eventID, tenantID, { includePast = false } = {}) {
    const event = await EventManager.getEvent(eventID, tenantID);
    const tenant = await TenantManager.getTenant(tenantID);

    if (!event || !event.isPublic) {
      throw new Error(`Event with ID ${eventID} not found`);
    }

    if (!includePast && event.isPast()) {
      throw new Error(`Event with ID ${eventID} not found`);
    }

    return this.generateEventCal(event, tenant);
  }

  static async getMultiEventCal(
    eventIDs,
    tenantID,
    { includePast = false, from = null, to = null } = {},
  ) {
    const events = await EventManager.getEvents(tenantID);
    const tenant = await TenantManager.getTenant(tenantID);

    if (!events || events.length === 0) {
      return this.generateMultiEventCal([], tenant);
    }

    const fromDate = from ? new Date(Number(from)) : null;
    const toDate = to ? new Date(Number(to)) : null;

    const filteredEvents = events.filter((event) => {
      if (!event.isPublic) return false;
      if (!includePast && event.isPast()) return false;
      if (eventIDs?.length > 0 && !eventIDs.includes(event.id)) return false;

      if (fromDate || toDate) {
        const info = event.information;
        if (!info?.startDate) return false;

        const eventStart = new Date(
          `${info.startDate}T${info.startTime || "00:00"}`,
        );
        const eventEnd = new Date(
          `${info.endDate || info.startDate}T${info.endTime || "23:59"}`,
        );

        if (fromDate && eventEnd < fromDate) return false;
        if (toDate && eventStart > toDate) return false;
      }

      return true;
    });

    return this.generateMultiEventCal(filteredEvents, tenant);
  }

  static generateEventCal(event, tenant) {
    const cal = ical({
      name: tenant?.name ? `${tenant.name} – Veranstaltung` : "Veranstaltung",
      prodId: {
        company: tenant?.name || "Buchungsplattform",
        product: "Event",
      },
    });

    ICalService._addEvent(cal, event);

    return cal;
  }

  static generateMultiEventCal(events, tenant) {
    const cal = ical({
      name: tenant?.name
        ? `${tenant.name} – Veranstaltungen`
        : "Veranstaltungen",
      prodId: {
        company: tenant?.name || "Buchungsplattform",
        product: "Event",
      },
    });

    for (const event of events) {
      ICalService._addEvent(cal, event);
    }

    return cal;
  }

  static async getBookingCal(bookingID, tenantID) {
    const booking = await BookingManager.getBooking(bookingID, tenantID);
    const tenant = await TenantManager.getTenant(tenantID);

    if (!booking) {
      throw new Error(`Booking with ID ${bookingID} not found`);
    }

    const cal = ical({
      name: tenant?.name ? `${tenant.name} – Buchung` : "Buchung",
      prodId: {
        company: tenant?.name || "Buchungsplattform",
        product: "Booking",
      },
    });

    await ICalService._addBooking(cal, booking, tenantID);

    return cal;
  }

  static async getMultiBookingCal(
    bookingIDs,
    tenantID,
    { from = null, to = null } = {},
  ) {
    const bookings = bookingIDs?.length
      ? await Promise.all(
          bookingIDs.map((id) => BookingManager.getBooking(id, tenantID)),
        )
      : [];

    const tenant = await TenantManager.getTenant(tenantID);

    const cal = ical({
      name: tenant?.name ? `${tenant.name} – Buchungen` : "Buchungen",
      prodId: {
        company: tenant?.name || "Buchungsplattform",
        product: "Booking",
      },
    });

    const fromDate = from ? new Date(Number(from)) : null;
    const toDate = to ? new Date(Number(to)) : null;

    for (const booking of bookings) {
      if (!booking) continue;

      if (fromDate || toDate) {
        const { start, end } = await ICalService._resolveBookingTimes(
          booking,
          tenantID,
        );
        if (!start || !end) continue;
        if (fromDate && end < fromDate) continue;
        if (toDate && start > toDate) continue;
      }

      await ICalService._addBooking(cal, booking, tenantID);
    }

    return cal;
  }

  /**
   * @private
   */
  static async _resolveBookingTimes(booking, tenantID) {
    const hasOwnTimes = booking.timeBegin && booking.timeEnd;

    if (hasOwnTimes) {
      return {
        start: new Date(Number(booking.timeBegin)),
        end: new Date(Number(booking.timeEnd)),
      };
    }

    for (const item of booking.bookableItems || []) {
      const bookable =
        item._bookableUsed ||
        (await BookableManager.getBookable(item.bookableId, tenantID));

      if (bookable?.type === "ticket" && bookable.eventId) {
        const event = await EventManager.getEvent(bookable.eventId, tenantID);
        if (event?.information) {
          const info = event.information;
          const start = new Date(
            `${info.startDate}T${info.startTime || "00:00"}`,
          );
          const end = new Date(
            `${info.endDate || info.startDate}T${info.endTime || "23:59"}`,
          );

          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return { start, end };
          }
        }
      }
    }

    return { start: null, end: null };
  }

  /**
   * @private
   */
  static async _addBooking(cal, booking, tenantID) {
    const { start, end } = await ICalService._resolveBookingTimes(
      booking,
      tenantID,
    );

    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return;
    }

    const bookableNames = [];
    let location = null;

    for (const item of booking.bookableItems || []) {
      const bookable =
        item._bookableUsed ||
        (await BookableManager.getBookable(item.bookableId, tenantID));
      if (bookable?.title) {
        bookableNames.push(bookable.title);
      }

      if (!location && bookable?.location) {
        const loc = bookable.location;

        if (typeof loc === "string") {
          location = loc;
        } else {
          const locationParts = [];

          if (loc.address) {
            const addr = loc.address;
            const street = [addr.street, addr.house_number]
              .filter(Boolean)
              .join(" ");
            const cityLine = [addr.postcode, addr.city]
              .filter(Boolean)
              .join(" ");
            if (street) locationParts.push(street);
            if (addr.suburb) locationParts.push(addr.suburb);
            if (cityLine) locationParts.push(cityLine);
            if (addr.country) locationParts.push(addr.country);
          }

          location =
            locationParts.length > 0
              ? locationParts.join(", ")
              : loc.display_address || null;
        }
      }
    }

    const summary =
      bookableNames.length > 0
        ? `Buchung: ${bookableNames.join(", ")}`
        : `Buchung ${booking.id}`;

    const descriptionParts = [];
    descriptionParts.push(`Buchungsnr.: ${booking.id}`);
    if (booking.name) descriptionParts.push(`Name: ${booking.name}`);
    if (booking.company) descriptionParts.push(`Firma: ${booking.company}`);

    const eventData = {
      id: `Buchung-${booking.id}`,
      start,
      end,
      summary,
      description: descriptionParts.join("\n"),
    };

    if (location) {
      eventData.location = location;
    }

    cal.createEvent(eventData);
  }

  /**
   * @private
   */
  static _addEvent(cal, event) {
    if (!event?.information) return;

    const info = event.information;

    const start = new Date(`${info.startDate}T${info.startTime || "00:00"}`);
    const end = new Date(`${info.endDate}T${info.endTime || "23:59"}`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    const plainDescription = (info.description || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    const eventData = {
      id: `event-${event.id}`,
      start,
      end,
      summary: info.name || "Veranstaltung",
      description: plainDescription,
    };

    const locationParts = [];
    if (event.eventLocation?.name) {
      locationParts.push(event.eventLocation.name);
    }
    if (event.eventAddress) {
      const addr = event.eventAddress;
      const street = [addr.street, addr.houseNumber].filter(Boolean).join(" ");
      const cityLine = [addr.zip, addr.city].filter(Boolean).join(" ");
      if (street) locationParts.push(street);
      if (addr.additional) locationParts.push(addr.additional);
      if (cityLine) locationParts.push(cityLine);
    }
    if (locationParts.length > 0) {
      eventData.location = locationParts.join(", ");
    }

    cal.createEvent(eventData);
  }
}

module.exports = ICalService;
