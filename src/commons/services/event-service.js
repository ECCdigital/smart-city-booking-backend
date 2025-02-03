const { v4: uuidv4 } = require("uuid");
const { Event } = require("../entities/event");
const { Bookable } = require("../entities/bookable");
const EventManager = require("../data-managers/event-manager");
const { BookableManager } = require("../data-managers/bookable-manager");

class EventService {
  static async createEvent(tenantId, rawEvent, user, withTickets = false) {
    const event = Object.assign(new Event(), rawEvent);

    event.id = uuidv4();
    event.ownerUserId = user?.id;

    await EventManager.storeEvent(event);
    if (withTickets) {
      const ticket = Object.assign(new Bookable(), {
        tenant: tenantId,
        eventId: event.id,
        id: uuidv4(),
        ownerUserId: user?.id,
        type: "ticket",
        title: event.information.name,
        description: event.information.teaserText,
        isBookable: true,
        isPublic: true,
        autoCommitBooking: true,
      });
      await BookableManager.storeBookable(ticket);
    }
  }
}

module.exports = EventService;
