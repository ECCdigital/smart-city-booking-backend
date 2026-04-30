const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const ExternalPriceService = require("../../../commons/services/external-price-service");

class JSONController {
  static async getBookables(req, res) {
    const { tenant: tenantId } = req.params;
    const { type, ids } = req.query;


    const identity = req.user;

    try {
      const userRoles = await JSONController.getUserRoles(tenantId, identity);
      let bookables = await BookableManager.getBookables(tenantId);

      bookables = bookables.filter((bookable) => bookable.isPublic);

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
          ? await BookableManager.getBookablesByIds(tenantId, allRelatedIds)
          : [];

      const relatedMap = new Map(relatedBookables.map((b) => [b.id, b]));

      const externalCache = new Map();


      const result = bookables.map(async (bookable) => {
        const pub = bookable.exportPublic();

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
          .filter(
            (b) =>
              b &&
              b.isPublic &&
              JSONController.hasAccess(b, identity, userRoles),
          )
          .map((b) => b.exportPublic());
        return pub;
      });

      res.setHeader("content-type", "application/json");
      res.status(200).send(await Promise.all(result));
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  static async getBookable(req, res) {
    const { tenant: tenantId, id } = req.params;

    const identity = req.user;
    const userRoles = await JSONController.getUserRoles(tenantId, identity);

    try {
      const bookable = await BookableManager.getBookable(id, tenantId);

      if (!bookable?.id || bookable.isPublic === false) {
        return res.status(404).json({
          success: false,
          message: "Bookable not found",
        });
      }

      const hasAccess = JSONController.hasAccess(bookable, identity, userRoles);

      if (hasAccess) {
        const pub = bookable.exportPublic();

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
              )
            : [];

        pub.relatedBookables = relatedBookables
          .filter(
            (b) =>
              b.isPublic && JSONController.hasAccess(b, identity, userRoles),
          )
          .map((b) => b.exportPublic());

        res.setHeader("content-type", "application/json");
        res.status(200).send(pub);
      } else {
        res.status(404).json({
          success: false,
          message: "Bookable not found",
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  static async getEvents(req, res) {
    const { tenant: tenantId } = req.params;
    const { ids } = req.query;

    try {
      let events = await EventManager.getEvents(tenantId);

      events = events.filter((event) => event.isPublic);

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

      const publicEvents = events.map((event) => event.exportPublic());

      for (const event of publicEvents) {
        const tickets = await BookableManager.getEventBookables(
          tenantId,
          event.id,
        );
        event.tickets = tickets
          .filter((ticket) => ticket.isPublic)
          .map((ticket) => ticket.exportPublic());
      }

      res.setHeader("content-type", "application/json");
      res.status(200).send(publicEvents);
    } catch {
      res.sendStatus(500);
    }
  }

  static async getEvent(req, res) {
    const { tenant: tenantId, id } = req.params;
    try {
      const event = await EventManager.getEvent(id, tenantId);

      if (event?.id && event.isPublic === true) {
        const tickets = await BookableManager.getEventBookables(
          tenantId,
          event.id,
        );

        const publicEvent = event.exportPublic();
        publicEvent.tickets = tickets
          .filter((ticket) => ticket.isPublic)
          .map((ticket) => ticket.exportPublic());

        res.setHeader("content-type", "application/json");
        res.status(200).send(publicEvent);
      } else {
        res.status(404).send("Event not found");
      }
    } catch {
      res.sendStatus(500);
    }
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
