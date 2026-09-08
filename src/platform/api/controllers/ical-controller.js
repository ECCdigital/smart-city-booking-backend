const ICalService = require("../../../commons/services/ical-service");
const {
  sendIcalResponse,
  sendIcalFeed,
} = require("../../../commons/utilities/ical-response-helper");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  readsRecords,
  scopeOf,
} = require("../../../commons/services/authorization");
const EventManager = require("../../../commons/data-managers/event-manager");
const {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} = require("../../../errors/BaseError");
const { toBool } = require("../../../commons/utilities/parser");

function parseIds(raw) {
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/**
 * The reach that decides which private events a calendar may carry. The event
 * routes are public - everyone gets the public calendar - so `?includePrivate`
 * is the one place a reach beyond `public` is asked for: an anonymous caller
 * is sent to the login, a signed-in one without any bookable right is refused
 * (`ical.events`, authorize spec §3.1).
 *
 * @param {Object} request Express request
 * @returns {{reach: string, userId: string|null}}
 * @throws {UnauthorizedError|ForbiddenError}
 */
function privateScopeOf(request) {
  const scope = scopeOf(request);

  if (readsRecords(scope)) {
    return scope;
  }

  if (!scope.userId) throw new UnauthorizedError();
  throw new ForbiddenError();
}

class ICalController {
  /**
   * GET /:tenant/ical/events/:id
   */
  static async getEventIcal(req, res) {
    const { tenant, id } = req.params;
    const includePast = toBool(req.query.includePast);
    const includePrivate = toBool(req.query.includePrivate);

    const options = { includePast };

    if (includePrivate) {
      // The event within the reach of the request; none there is a 404.
      const event = await EventManager.getEvent(
        id,
        tenant,
        privateScopeOf(req),
      );
      if (!event) throw new NotFoundError("event_not_found");

      options.includePrivate = true;
    }

    const cal = await ICalService.getEventCal(id, tenant, options);
    sendIcalResponse(res, cal, `event-${id}`);
  }

  /**
   * GET /:tenant/ical/events?ids=id1,id2,id3
   */
  static async getEventsIcal(req, res) {
    const { tenant } = req.params;
    const { from, to } = req.query;
    const includePast = toBool(req.query.includePast);
    const includePrivate = toBool(req.query.includePrivate);

    const options = { includePast, from, to };
    let allowedIds = parseIds(req.query.ids);

    if (includePrivate) {
      const scope = privateScopeOf(req);

      // Under `any` every requested event may be shown; under `own` the
      // request narrows to the events of the caller, and a request that asks
      // for none of them is refused rather than answered with an empty
      // calendar (as today).
      if (scope.reach === "own") {
        const own = await EventManager.getEvents(tenant, scope);
        const ownIds = own.map((event) => event.id);
        allowedIds = allowedIds
          ? allowedIds.filter((id) => ownIds.includes(id))
          : ownIds;
        if (allowedIds.length === 0) throw new ForbiddenError();
      }

      options.includePrivate = true;
    }

    const cal = await ICalService.getMultiEventCal(allowedIds, tenant, options);
    sendIcalResponse(res, cal, "veranstaltungen");
  }

  /**
   * GET /:tenant/ical/bookings/:id
   */
  static async getBookingIcal(req, res) {
    const { tenant, id } = req.params;

    // The booking within the reach of the request; none there is a 404.
    const booking = await BookingManager.getBooking(id, tenant, scopeOf(req));
    if (!booking) throw new NotFoundError("booking_not_found");

    const cal = await ICalService.getBookingCal(id, tenant);
    sendIcalResponse(res, cal, `buchung-${id}`);
  }

  /**
   * GET /:tenant/ical/bookings?ids=id1,id2,id3
   */
  static async getBookingsIcal(req, res) {
    const { tenant } = req.params;
    const { from, to } = req.query;

    const ids = parseIds(req.query.ids);
    if (!ids) throw new BadRequestError("missing_ids");

    // The requested bookings within the reach of the request; a request that
    // names none of them is refused rather than answered with an empty
    // calendar (as today).
    const bookings = await BookingManager.getBookings(
      tenant,
      ids,
      scopeOf(req),
    );
    if (!bookings || bookings.length === 0) {
      throw new NotFoundError("bookings_not_found");
    }

    const allowedIds = bookings.map((b) => b.id);
    const cal = await ICalService.getMultiBookingCal(allowedIds, tenant, {
      from,
      to,
    });
    sendIcalResponse(res, cal, `buchungen-${allowedIds.join(",")}`);
  }

  /**
   * GET /:tenant/ical/feed/events/:id
   */
  static async getEventFeed(req, res) {
    const { tenant, id } = req.params;

    const cal = await ICalService.getEventCal(id, tenant, {
      includePast: true,
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    sendIcalFeed(res, cal);
  }

  /**
   * GET /:tenant/ical/feed/events?ids=id1,id2,id3
   */
  static async getEventsFeed(req, res) {
    const { tenant } = req.params;
    const ids = parseIds(req.query.ids);

    const cal = await ICalService.getMultiEventCal(ids, tenant, {
      includePast: true,
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    sendIcalFeed(res, cal);
  }
}

module.exports = ICalController;
