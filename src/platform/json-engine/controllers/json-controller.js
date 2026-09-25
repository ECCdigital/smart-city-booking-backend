const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { scopeOf } = require("../../../commons/services/authorization");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const InstanceManager = require("../../../commons/data-managers/instance-manager");
const ExternalPriceService = require("../../../commons/services/external-price-service");
const {
  enforceTenantCatalogAccess,
} = require("../../../commons/utilities/catalog-participation-utils");
const {
  GroupBookingPermissions,
} = require("../../../commons/utilities/group-booking-permissions");
const { NotFoundError } = require("../../../errors/BaseError");

/**
 * The JSON embed engine: every page reads through the managers with the
 * route's reach (`json.all`: the public's, staff included), so what it
 * shows is the public projection the managers apply (ADR 0003) - a list
 * what is listed, a detail what a direct link reaches, the tickets of an
 * event what is listed of them, a tenant without a public projection a
 * 404. On top of it the tenant's own catalog participation and the
 * bookable's own permissions (`hasAccess`), which are no supervision.
 */
class JSONController {
  // The catalog access refusals are the typed errors of the errors module
  // (`tenant_not_found`, `authentication_required`,
  // `tenant_membership_required`); the embed API keeps its own body shape.
  static _sendCatalogAccessError(res, error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }

  /**
   * @returns {Promise<object|false>} Loaded tenant on success, false after writing an error response.
   */
  static async _enforceCatalogAccess(res, tenantId, identity) {
    try {
      return await enforceTenantCatalogAccess(tenantId, identity?.id);
    } catch (error) {
      JSONController._sendCatalogAccessError(res, error);
      return false;
    }
  }

  static async _checkoutUrl(bookableId, tenantId, instance) {
    const checkoutInstance = instance || (await InstanceManager.getInstance());

    if (
      checkoutInstance &&
      !checkoutInstance.checkout.useLegacyCheckout &&
      checkoutInstance.checkout.checkoutUrl
    ) {
      return `${checkoutInstance.checkout.checkoutUrl}/checkout/${bookableId}/?tenantId=${tenantId}`;
    }

    return `${process.env.FRONTEND_URL}/checkout/?id=${bookableId}&tenant=${tenantId}`;
  }

  static async _exportPublicBookable(
    bookable,
    tenantId,
    instance,
    { identity, userRoles, cancellationRefundTiers = [] } = {},
  ) {
    // Embedding websites live on foreign hosts, so every media address has to
    // leave here absolute.
    const pub = bookable.exportPublic({ absoluteMediaUrls: true });
    pub.checkoutUrl = await JSONController._checkoutUrl(
      bookable.id,
      tenantId,
      instance,
    );
    pub.groupBookingAllowed = GroupBookingPermissions.isAllowed(
      bookable,
      identity,
      userRoles,
    );
    pub.cancellationRefundTiers = cancellationRefundTiers;
    return pub;
  }

  static async getBookables(req, res) {
    const { tenant: tenantId } = req.params;
    const { type, ids } = req.query;

    const identity = req.user;

    const tenant = await JSONController._enforceCatalogAccess(
      res,
      tenantId,
      identity,
    );
    if (!tenant) {
      return;
    }

    const cancellationRefundTiers = tenant.cancellationRefundTiers || [];

    try {
      const userRoles = await JSONController.getUserRoles(tenantId, identity);
      let bookables = await BookableManager.getBookables(
        tenantId,
        scopeOf(req),
      );

      bookables = bookables.filter((bookable) => {
        return JSONController.hasAccess(bookable, identity, userRoles);
      });

      if (type) {
        bookables = bookables.filter((bookable) => bookable.type === type);
      }

      if (ids) {
        const idsArray = ids.split(",");
        bookables = bookables.filter((bookable) =>
          idsArray.includes(bookable.id),
        );
      }

      bookables.reverse();

      const allRelatedIds = [
        ...new Set(bookables.flatMap((b) => b.relatedBookableIds ?? [])),
      ];

      const relatedBookables =
        allRelatedIds.length > 0
          ? await BookableManager.getBookablesByIds(
              tenantId,
              allRelatedIds,
              scopeOf(req),
            )
          : [];

      const relatedMap = new Map(relatedBookables.map((b) => [b.id, b]));

      const externalCache = new Map();
      const checkoutInstance =
        bookables.length > 0 ? await InstanceManager.getInstance() : null;

      const exportOptions = { identity, userRoles, cancellationRefundTiers };

      const result = bookables.map(async (bookable) => {
        const pub = await JSONController._exportPublicBookable(
          bookable,
          tenantId,
          checkoutInstance,
          exportOptions,
        );

        const extPrices = await ExternalPriceService.resolve(
          bookable,
          tenantId,
          externalCache,
        );

        if (extPrices) {
          pub.priceCategories = extPrices;
        }

        pub.relatedBookables = (bookable.relatedBookableIds ?? [])
          .map((id) => relatedMap.get(id))
          .filter((b) => b && JSONController.hasAccess(b, identity, userRoles));
        pub.relatedBookables = await Promise.all(
          pub.relatedBookables.map((b) =>
            JSONController._exportPublicBookable(
              b,
              tenantId,
              checkoutInstance,
              exportOptions,
            ),
          ),
        );
        return pub;
      });

      res.setHeader("content-type", "application/json");
      res.status(200).send(await Promise.all(result));
    } catch (error) {
      JSONController._fail(res, error, "No bookables found");
    }
  }

  static async getBookable(req, res) {
    const { tenant: tenantId, id } = req.params;

    const identity = req.user;

    const tenant = await JSONController._enforceCatalogAccess(
      res,
      tenantId,
      identity,
    );
    if (!tenant) {
      return;
    }

    const cancellationRefundTiers = tenant.cancellationRefundTiers || [];

    try {
      const userRoles = await JSONController.getUserRoles(tenantId, identity);
      const exportOptions = { identity, userRoles, cancellationRefundTiers };
      const bookable = await BookableManager.getBookable(
        id,
        tenantId,
        scopeOf(req),
      );

      if (!bookable?.id) {
        return res.status(404).json({
          success: false,
          message: "Bookable not found",
        });
      }

      const hasAccess = JSONController.hasAccess(bookable, identity, userRoles);

      if (hasAccess) {
        const checkoutInstance = await InstanceManager.getInstance();
        const pub = await JSONController._exportPublicBookable(
          bookable,
          tenantId,
          checkoutInstance,
          exportOptions,
        );

        const extPrices = await ExternalPriceService.resolve(
          bookable,
          tenantId,
        );
        if (extPrices) {
          pub.priceCategories = extPrices;
        }

        const relatedBookables =
          bookable.relatedBookableIds?.length > 0
            ? await BookableManager.getBookablesByIds(
                tenantId,
                bookable.relatedBookableIds,
                scopeOf(req),
              )
            : [];

        pub.relatedBookables = relatedBookables.filter((b) =>
          JSONController.hasAccess(b, identity, userRoles),
        );
        pub.relatedBookables = await Promise.all(
          pub.relatedBookables.map((b) =>
            JSONController._exportPublicBookable(
              b,
              tenantId,
              checkoutInstance,
              exportOptions,
            ),
          ),
        );

        res.setHeader("content-type", "application/json");
        res.status(200).send(pub);
      } else {
        res.status(404).json({
          success: false,
          message: "Bookable not found",
        });
      }
    } catch (error) {
      JSONController._fail(res, error, "Bookable not found");
    }
  }

  static async getEvents(req, res) {
    const { tenant: tenantId } = req.params;
    const { ids } = req.query;

    const tenant = await JSONController._enforceCatalogAccess(
      res,
      tenantId,
      req.user,
    );
    if (!tenant) {
      return;
    }

    const cancellationRefundTiers = tenant.cancellationRefundTiers || [];

    try {
      const identity = req.user;
      const userRoles = await JSONController.getUserRoles(tenantId, identity);
      let events = await EventManager.getEvents(tenantId, scopeOf(req));
      const checkoutInstance = await InstanceManager.getInstance();
      const exportOptions = { identity, userRoles, cancellationRefundTiers };

      if (ids) {
        const idsArray = ids.split(",");
        events = events.filter((event) => idsArray.includes(event.id));
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      events = events
        .filter(
          (event) =>
            event.information &&
            event.information.endDate &&
            new Date(event.information.endDate) >= yesterday,
        )
        .sort(
          (a, b) =>
            Date.parse(a.information.startDate) -
            Date.parse(b.information.startDate),
        );

      const publicEvents = events.map((event) =>
        event.exportPublic({ absoluteMediaUrls: true }),
      );

      for (const event of publicEvents) {
        const tickets = await BookableManager.getEventBookables(
          tenantId,
          event.id,
          scopeOf(req),
        );
        event.tickets = await Promise.all(
          tickets.map((ticket) =>
            JSONController._exportPublicBookable(
              ticket,
              tenantId,
              checkoutInstance,
              exportOptions,
            ),
          ),
        );
      }

      res.setHeader("content-type", "application/json");
      res.status(200).send(publicEvents);
    } catch (error) {
      JSONController._fail(res, error, "No events found");
    }
  }

  static async getEvent(req, res) {
    const { tenant: tenantId, id } = req.params;

    const tenant = await JSONController._enforceCatalogAccess(
      res,
      tenantId,
      req.user,
    );
    if (!tenant) {
      return;
    }

    const cancellationRefundTiers = tenant.cancellationRefundTiers || [];

    try {
      const identity = req.user;
      const userRoles = await JSONController.getUserRoles(tenantId, identity);
      const event = await EventManager.getEvent(id, tenantId, scopeOf(req));
      const checkoutInstance = await InstanceManager.getInstance();
      const exportOptions = { identity, userRoles, cancellationRefundTiers };

      if (event?.id) {
        const tickets = await BookableManager.getEventBookables(
          tenantId,
          event.id,
          scopeOf(req),
        );

        const publicEvent = event.exportPublic({ absoluteMediaUrls: true });
        publicEvent.tickets = await Promise.all(
          tickets.map((ticket) =>
            JSONController._exportPublicBookable(
              ticket,
              tenantId,
              checkoutInstance,
              exportOptions,
            ),
          ),
        );

        res.setHeader("content-type", "application/json");
        res.status(200).send(publicEvent);
      } else {
        res.status(404).send("Event not found");
      }
    } catch (error) {
      JSONController._fail(res, error, "Event not found");
    }
  }

  /** The public's 404 of a tenant without a projection, a 500 for the rest. */
  static _fail(res, error, notFoundMessage) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: notFoundMessage });
    }
    res.status(500).json({ success: false, message: "Internal server error" });
  }

  static async getUserRoles(tenantId, identity) {
    if (!identity) return null;

    try {
      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        identity.id,
      );
      return membership?.roles ?? null;
    } catch (error) {
      return null;
    }
  }

  static hasAccess(bookable, identity, userRoles) {
    try {
      const permittedUsers = bookable.permittedUsers ?? [];
      const permittedRoles = bookable.permittedRoles ?? [];

      if (permittedUsers.length === 0 && permittedRoles.length === 0) {
        return true;
      }

      if (!identity) return false;

      const norm = (v) => String(v).trim().toLowerCase();
      const identityIdNorm = norm(identity.id);
      const permittedUsersNorm = permittedUsers.map(norm);

      const userMatch = permittedUsersNorm.includes(identityIdNorm);
      const roleMatch =
        userRoles?.some((r) => permittedRoles.includes(r)) ?? false;

      return userMatch || roleMatch;
    } catch {
      return false;
    }
  }
}

module.exports = JSONController;
