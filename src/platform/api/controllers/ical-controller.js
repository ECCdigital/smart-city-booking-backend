const ICalService = require("../../../commons/services/ical-service");
const {
  sendIcalResponse,
  sendIcalFeed,
} = require("../../../commons/utilities/ical-response-helper");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const UserManager = require("../../../commons/data-managers/user-manager");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionsService = require("../../../commons/services/permission-service");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");
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

async function requireUser(request, useOptionalAuth = false) {
  const user = useOptionalAuth
    ? await authenticateIfNeeded(request, true)
    : request.user;

  if (!user) throw new UnauthorizedError();
  return user;
}

async function filterByReadPermission(entities, userId, tenant, permission) {
  const checks = await Promise.all(
    entities.map(async (entity) => ({
      entity,
      allowed: await PermissionsService._allowRead(
        entity,
        userId,
        tenant,
        permission,
      ),
    })),
  );
  return checks.filter((c) => c.allowed).map((c) => c.entity);
}

async function resolveAllowedIds({
  user,
  tenant,
  permission,
  requestedIds,
  fetchAll,
}) {
  const hasReadAny = await UserManager.hasPermission(
    user.id,
    tenant,
    permission,
    "readAny",
  );

  if (hasReadAny) return requestedIds;

  const allEntities = await fetchAll(tenant);
  const allowed = await filterByReadPermission(
    allEntities,
    user.id,
    tenant,
    permission,
  );
  const allowedIds = allowed.map((e) => e.id);

  if (requestedIds) {
    const filtered = requestedIds.filter((id) => allowedIds.includes(id));
    if (filtered.length === 0) throw new ForbiddenError();
    return filtered;
  }

  if (allowedIds.length === 0) throw new ForbiddenError();
  return allowedIds;
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
      const user = await requireUser(req, true);
      const event = await EventManager.getEvent(id, tenant);
      if (!event) throw new NotFoundError("event_not_found");

      const allowed = await PermissionsService._allowRead(
        event,
        user.id,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
      );
      if (!allowed) throw new ForbiddenError();

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
      const user = await requireUser(req, true);
      allowedIds = await resolveAllowedIds({
        user,
        tenant,
        permission: RolePermission.MANAGE_BOOKABLES,
        requestedIds: allowedIds,
        fetchAll: (t) => EventManager.getEvents(t),
      });
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
    const user = await requireUser(req);

    const booking = await BookingManager.getBooking(id, tenant);
    if (!booking) throw new NotFoundError("booking_not_found");

    const hasReadAny = await UserManager.hasPermission(
      user.id,
      tenant,
      RolePermission.MANAGE_BOOKINGS,
      "readAny",
    );

    if (!hasReadAny) {
      const allowed = await PermissionsService._allowRead(
        booking,
        user.id,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
      );
      if (!allowed) throw new ForbiddenError();
    }

    const cal = await ICalService.getBookingCal(id, tenant);
    sendIcalResponse(res, cal, `buchung-${id}`);
  }

  /**
   * GET /:tenant/ical/bookings?ids=id1,id2,id3
   */
  static async getBookingsIcal(req, res) {
    const { tenant } = req.params;
    const { from, to } = req.query;
    const user = await requireUser(req);

    const ids = parseIds(req.query.ids);
    if (!ids) throw new BadRequestError("missing_ids");

    const bookings = await BookingManager.getBookings(tenant, ids);
    if (!bookings || bookings.length === 0) {
      throw new NotFoundError("bookings_not_found");
    }

    const hasReadAny = await UserManager.hasPermission(
      user.id,
      tenant,
      RolePermission.MANAGE_BOOKINGS,
      "readAny",
    );

    let allowedBookings = bookings;
    if (!hasReadAny) {
      allowedBookings = await filterByReadPermission(
        bookings,
        user.id,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
      );
      if (allowedBookings.length === 0) throw new ForbiddenError();
    }

    const allowedIds = allowedBookings.map((b) => b.id);
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
