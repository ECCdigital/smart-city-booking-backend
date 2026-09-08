const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const HtmlEngine = require("../html-engine");
const EventManager = require("../../../commons/data-managers/event-manager");
const {
  readsRecords,
  scopeOf,
} = require("../../../commons/services/authorization");

class HtmlController {
  static async getBookables(request, response) {
    const tenantId = request.params.tenant;
    const type = request.query.type;
    const ids = request.query.ids;
    const sanitizedIds =
      ids
        ?.split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0) || null;
    let bookables = await BookableManager.getBookables(tenantId);
    bookables = bookables.filter((bookable) => bookable.isPublic);

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
  }

  static async getBookable(request, response) {
    const tenantId = request.params.tenant;
    const id = request.params.id;
    const sanitizedId = id.trim();
    const bookable = await BookableManager.getBookable(sanitizedId, tenantId);

    // if bookable is not bookable, return 404
    if (bookable?.id && bookable.isPublic === true) {
      const htmlOutput = await HtmlEngine.bookable(bookable);
      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } else {
      response.status(404).send("Bookable not found");
    }
  }

  static async getEvents(request, response) {
    const tenantId = request.params.tenant;
    const ids = request.query.ids;
    const sanitizedIds =
      ids
        ?.split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0) || null;
    let events = await EventManager.getEvents(tenantId);
    events = events.filter((event) => event.isPublic);

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
  }

  static async getEvent(request, response) {
    // Whether the reader gets more than the public projection. The `html`
    // entry is public only, so this is false for everyone - as it was
    // before the route carried a marker and `request.user` was never set.
    const beyondPublic = readsRecords(scopeOf(request));
    const tenantId = request.params.tenant;
    const id = request.params.id;
    const sanitizedId = id.trim();
    const event = await EventManager.getEvent(sanitizedId, tenantId);

    if (event?.id) {
      const htmlOutput = await HtmlEngine.event(event, beyondPublic);

      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } else {
      response.status(404).send("Event not found");
    }
  }
}

module.exports = HtmlController;
