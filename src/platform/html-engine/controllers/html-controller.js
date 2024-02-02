const BookableManager = require("../../../commons/data-managers/bookable-manager");
const HtmlEngine = require("../html-engine");
const EventManager = require("../../../commons/data-managers/event-manager");

class HtmlController {
  static async getBookables(request, response) {
    const tenant = request.params.tenant;
    const type = request.query.type;
    const ids = request.query.ids;
    let bookables = await BookableManager.getBookables(tenant);
    bookables = bookables.filter((bookable) => bookable.isPublic);

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
    const htmlOutput = await HtmlEngine.bookablesToList(bookables);

    response.setHeader("content-type", "text/plain");
    response.status(200).send(htmlOutput);
  }

  static async getBookable(request, response) {
    const tenant = request.params.tenant;
    const id = request.params.id;
    const bookable = await BookableManager.getBookable(id, tenant);
    const htmlOutput = await HtmlEngine.bookable(bookable);

    // if bookable is not bookable, return 404
    if (bookable.id && bookable.isPublic === true) {
      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } else {
      response.status(404).send("Bookable not found");
    }
  }

  static async getEvents(request, response) {
    const tenant = request.params.tenant;
    const ids = request.query.ids;
    let events = await EventManager.getEvents(tenant);
    events = events.filter((event) => event.isPublic);

    if (ids) {
      const idsArray = ids.split(",");
      events = events.filter((event) => idsArray.includes(event.id));
    }

    events = events
      .filter(
        (event) =>
          event.information &&
          event.information.endDate &&
          Date.parse(event.information.endDate) + 1 >= new Date(),
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
    const user = request.user;
    const tenant = request.params.tenant;
    const id = request.params.id;
    const event = await EventManager.getEvent(id, tenant);

    if (event.id) {
      const htmlOutput = await HtmlEngine.event(event, !!user);

      response.setHeader("content-type", "text/plain");
      response.status(200).send(htmlOutput);
    } else {
      response.status(404).send("Event not found");
    }
  }
}

module.exports = HtmlController;
