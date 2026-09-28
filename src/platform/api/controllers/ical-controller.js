const ICalService = require("../../../commons/services/ical-service");
const {
  sendIcalResponse,
  sendIcalFeed,
} = require("../../../commons/utilities/ical-response-helper");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  readsRecords,
  scopeOf,
  PUBLIC,
} = require("../../../commons/services/authorization");
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
 * routes are public - everyone gets the public calendar, staff included (ADR
 * 0003) - so `?includePrivate` is the one place a reach beyond `public` is
 * asked for: an anonymous caller is sent to the login, a signed-in one
 * without any bookable right is refused (`ical.events`).
 * The one question about the reach here, on the named list of
 * `tests/authorization-handler-decisions.test.js`.
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

    // The public calendar, or the event within the reach of the request -
    // none there is a 404 (the service's).
    const options = { includePast, scope: PUBLIC };

    if (includePrivate) {
      options.scope = privateScopeOf(req);
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

    const options = { includePast, from, to, scope: PUBLIC };
    const allowedIds = parseIds(req.query.ids);

    // The calendar within the reach: under `any` every event, under `own`
    // the caller's - the service reads within the reach (ADR 0002), so a
    // request that names other events gets a calendar without them.
    if (includePrivate) {
      options.scope = privateScopeOf(req);
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

    const cal = await ICalService.getBookingCal(id, tenant, scopeOf(req));
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
      scope: scopeOf(req),
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
      scope: PUBLIC,
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
      scope: PUBLIC,
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    sendIcalFeed(res, cal);
  }
}

module.exports = ICalController;
