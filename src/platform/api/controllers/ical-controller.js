const ICalService = require("../../../commons/services/ical-service");
const {
  sendIcalResponse,
  sendIcalFeed,
} = require("../../../commons/utilities/ical-response-helper");
const BookingService = require("../../../commons/services/checkout/booking-service");
const BookingManager = require("../../../commons/data-managers/booking-manager");

class ICalController {
  /**
   * GET /:tenant/ical/events/:id
   */
  static async getEventIcal(request, response) {
    try {
      const { tenant, id } = request.params;

      const cal = await ICalService.getEventCal(id, tenant);
      sendIcalResponse(response, cal, `event-${id}`);
    } catch (error) {
      console.error("iCal Event-Export fehlgeschlagen:", error);
      response.status(500).send({ error: "Internal Server Error" });
    }
  }

  /**
   * GET /:tenant/ical/events?ids=id1,id2,id3
   */
  static async getEventsIcal(request, response) {
    try {
      const { tenant } = request.params;
      const { ids, from, to } = request.query;

      const cal = await ICalService.getMultiEventCal(ids, tenant, {
        from,
        to,
      });

      console.log("cal", cal);

      sendIcalResponse(response, cal, "veranstaltungen");
    } catch (error) {
      response.status(500).send({ error: "Internal Server Error" });
    }
  }

  /**
   * GET /:tenant/ical/bookings/:id
   */
  static async getBookingIcal(request, response) {
    try {
      const { tenant, id } = request.params;

      const booking = await BookingManager.getBooking(id, tenant);

      if (!booking) {
        response.status(404).send({ error: "Booking not found" });
        return;
      }

      //TODO: Check permissions

      const cal = await ICalService.getBookingCal(id, tenant);
      sendIcalResponse(response, cal, `Buchung-${id}`);
    } catch (error) {
      console.error("iCal Buchungsexport fehlgeschlagen:", error);
      response.status(500).send({ error: "Interner Serverfehler" });
    }
  }

  /**
   * GET /:tenant/ical/bookings?ids=id1,id2,id3
   */
  static async getBookingsIcal(request, response) {
    try {
      const { tenant } = request.params;
      const { ids, from, to } = request.query;

      const idsArray = ids.split(",").map((id) => id.trim());

      const bookings = await BookingManager.getBookings(tenant, idsArray);

      //TODO: Check permissions for each booking

      const cal = await ICalService.getMultiBookingCal(idsArray, tenant, {
        from,
        to,
      });

      sendIcalResponse(response, cal, `Buchungen-${ids}`);
    } catch (error) {
      response.status(500).send({ error: "Internal Server Error" });
    }
  }

  /**
   * GET /:tenant/ical/feed/events/:id
   */
  static async getEventFeed(request, response) {
    try {
      const { tenant, id } = request.params;

      const cal = await ICalService.getEventCal(id, tenant, {
        includePast: true,
      });

      response.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate",
      );
      sendIcalFeed(response, cal);
    } catch (error) {
      response.status(500).send({ error: "Interner Fehler" });
    }
  }

  /**
   * GET /:tenant/ical/feed/events?ids=id1,id2,id3
   */
  static async getEventsFeed(request, response) {
    try {
      const { tenant } = request.params;
      const { ids } = request.query;

      const cal = await ICalService.getMultiEventCal(ids, tenant, {
        includePast: true,
      });

      response.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate",
      );
      sendIcalFeed(response, cal);
    } catch (error) {
      response.status(500).send({ error: "Internal Server Error" });
    }
  }
}

module.exports = ICalController;
