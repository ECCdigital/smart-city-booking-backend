const ICalService = require("../../../commons/services/ical-service");
const {
  sendIcalResponse,
  sendIcalFeed,
} = require("../../../commons/utilities/ical-response-helper");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const UserManager = require("../../../commons/data-managers/user-manager");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionsService = require("../../../commons/services/permission-service");

class ICalController {
  /**
   * GET /:tenant/ical/events/:id
   */
  static async getEventIcal(request, response) {
    try {
      const { tenant, id } = request.params;
      const { includePast } = request.query;

      const includePastBoolean = includePast === "true";

      const cal = await ICalService.getEventCal(id, tenant, {
        includePast: includePastBoolean,
      });
      sendIcalResponse(response, cal, `event-${id}`);
    } catch (error) {
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
      const user = request.user;

      if (!user) {
        return response.status(401).send({ error: "Unauthorised" });
      }

      const booking = await BookingManager.getBooking(id, tenant);

      if (!booking) {
        return response.status(404).send({ error: "Booking not found" });
      }

      const hasReadAny = await UserManager.hasPermission(
        user.id,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readAny",
      );

      const hasReadOwn =
        hasReadAny ||
        (await PermissionsService._allowRead(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        ));

      if (!hasReadOwn) {
        return response.status(403).send({ error: "Forbidden" });
      }

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
      const user = request.user;

      if (!user) {
        return response.status(401).send({ error: "Unauthorised" });
      }

      if (!ids) {
        return response.status(400).send({ error: "Missing ids parameter" });
      }

      const idsArray = ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (idsArray.length === 0) {
        return response.status(400).send({ error: "No valid ids provided" });
      }

      const bookings = await BookingManager.getBookings(tenant, idsArray);

      if (!bookings || bookings.length === 0) {
        return response.status(404).send({ error: "No bookings found" });
      }

      const hasReadAny = await UserManager.hasPermission(
        user.id,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readAny",
      );

      let allowedBookings = bookings;

      if (!hasReadAny) {
        const permissionChecks = await Promise.all(
          bookings.map(async (booking) => ({
            booking,
            allowed: await PermissionsService._allowRead(
              booking,
              user.id,
              tenant,
              RolePermission.MANAGE_BOOKINGS,
            ),
          })),
        );

        allowedBookings = permissionChecks
          .filter(({ allowed }) => allowed)
          .map(({ booking }) => booking);
      }

      if (allowedBookings.length === 0) {
        return response.status(403).send({ error: "Forbidden" });
      }

      const allowedIds = allowedBookings.map((b) => b.id);
      const cal = await ICalService.getMultiBookingCal(allowedIds, tenant, {
        from,
        to,
      });

      sendIcalResponse(response, cal, `Buchungen-${allowedIds.join(",")}`);
    } catch (error) {
      response.status(500).send({ error: "Interner Serverfehler" });
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
