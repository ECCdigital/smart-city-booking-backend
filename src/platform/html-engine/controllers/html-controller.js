const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const HtmlEngine = require("../html-engine");
const EventManager = require("../../../commons/data-managers/event-manager");
const { scopeOf } = require("../../../commons/services/authorization");
const { BaseError } = require("../../../errors/BaseError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "html-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The HTML embed engine: every page reads through the managers with the
 * route's reach (`html.all`: the public's, staff included), so what a
 * page shows is the public projection the managers apply (ADR 0003) - a
 * list what is listed, a detail what a direct link reaches, a tenant
 * without a public projection a 404. The router is a plain one, so each
 * handler answers its own errors.
 */
class HtmlController {
  static async getBookables(request, response) {
    try {
      const tenantId = request.params.tenant;
      const type = request.query.type;
      const ids = request.query.ids;
      const sanitizedIds =
        ids
          ?.split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0) || null;
      let bookables = await BookableManager.getBookables(
        tenantId,
        scopeOf(request),
      );

      if (type) {
        bookables = bookables.filter((bookable) => bookable.type === type);
      }

      if (sanitizedIds && sanitizedIds.length > 0) {
        bookables = bookables.filter((bookable) =>
          sanitizedIds.includes(bookable.id),
        );
      }

      if (sanitizedIds && sanitizedIds.length > 0) {
        bookables.sort((a, b) => {
          return sanitizedIds.indexOf(a.id) - sanitizedIds.indexOf(b.id);
        });
      } else {
        bookables.reverse();
      }

      if (bookables.length === 0) {
        response.status(404).send("No bookables found");
        return;
      }

      const htmlOutput = await HtmlEngine.bookablesToList(bookables);

      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } catch (err) {
      HtmlController._fail(response, err, "No bookables found");
    }
  }

  static async getBookable(request, response) {
    try {
      const tenantId = request.params.tenant;
      const id = request.params.id;
      const sanitizedId = id.trim();
      const bookable = await BookableManager.getBookable(
        sanitizedId,
        tenantId,
        scopeOf(request),
      );

      if (bookable?.id) {
        const htmlOutput = await HtmlEngine.bookable(bookable);
        response.setHeader("content-type", "text/plain");
        response.status(200).send(htmlOutput);
      } else {
        response.status(404).send("Bookable not found");
      }
    } catch (err) {
      HtmlController._fail(response, err, "Bookable not found");
    }
  }

  static async getEvents(request, response) {
    try {
      const tenantId = request.params.tenant;
      const ids = request.query.ids;
      const sanitizedIds =
        ids
          ?.split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0) || null;
      let events = await EventManager.getEvents(tenantId, scopeOf(request));

      if (sanitizedIds && sanitizedIds.length > 0) {
        events = events.filter((event) => sanitizedIds.includes(event.id));
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

      const htmlOutput = await HtmlEngine.eventsToList(events);

      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } catch (err) {
      HtmlController._fail(response, err, "No events found");
    }
  }

  static async getEvent(request, response) {
    try {
      const tenantId = request.params.tenant;
      const id = request.params.id;
      const sanitizedId = id.trim();
      const event = await EventManager.getEvent(
        sanitizedId,
        tenantId,
        scopeOf(request),
      );

      if (event?.id) {
        // The attachments are the tenant's own to see, never the public's.
        const htmlOutput = await HtmlEngine.event(event, false);

        response.setHeader("content-type", "text/plain");
        response.status(200).send(htmlOutput);
      } else {
        response.status(404).send("Event not found");
      }
    } catch (err) {
      HtmlController._fail(response, err, "Event not found");
    }
  }

  /** A typed error answers its status (the public's 404), the rest a 500. */
  static _fail(response, err, notFoundText) {
    if (err instanceof BaseError) {
      return response
        .status(err.statusCode)
        .send(err.statusCode === 404 ? notFoundText : err.message);
    }
    logger.error(err);
    response.status(500).send("Internal server error");
  }
}

module.exports = HtmlController;
