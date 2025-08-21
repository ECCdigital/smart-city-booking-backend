const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");

class JSONController {
  static async getBookables(req, res) {
    const { tenant: tenantId } = req.params;
    const { type, ids } = req.query;

    try {
      let bookables = await BookableManager.getBookables(tenantId);
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

      res.setHeader("content-type", "application/json");
      res
        .status(200)
        .send(bookables.map((bookable) => bookable.exportPublic()));
    } catch {
      res.sendStatus(500);
    }
  }

  static async getBookable(req, res) {
    const { tenant: tenantId, id } = req.params;
    try {
      const bookable = await BookableManager.getBookable(id, tenantId);

      if (bookable?.id && bookable.isPublic === true) {
        res.setHeader("content-type", "application/json");
        res.status(200).send(bookable.exportPublic());
      } else {
        res.status(404).send("Bookable not found");
      }
    } catch {
      res.sendStatus(500);
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

      res.setHeader("content-type", "application/json");
      res.status(200).send(events.map((event) => event.exportPublic()));
    } catch {
      res.sendStatus(500);
    }
  }

  static async getEvent(req, res) {
    const { tenant: tenantId, id } = req.params;
    try {
      const event = await EventManager.getEvent(id, tenantId);

      if (event?.id && event.isPublic === true) {
        res.setHeader("content-type", "application/json");
        res.status(200).send(event.exportPublic());
      } else {
        res.status(404).send("Event not found");
      }
    } catch {
      res.sendStatus(500);
    }
  }
}

module.exports = JSONController;
