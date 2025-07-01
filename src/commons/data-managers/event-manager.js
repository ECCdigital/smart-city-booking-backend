const { Event } = require("../entities/event/event");
const EventModel = require("./models/eventModel");

/**
 * Data Manager for Event objects.
 */
class EventManager {
  /**
   * Get all events related to a tenant
   * @param {string} tenantId Identifier of the tenant
   * @returns List of bookings
   */
  static async getEvents(tenantId) {
    const rawEvents = await EventModel.find({
      tenantId: tenantId,
    });
    return rawEvents.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific event object from the database.
   *
   * @param {string} id Logical identifier of the event object
   * @param {string} tenantId Identifier of the tenant
   * @returns A single event object
   */
  static async getEvent(id, tenantId) {
    const rawEvent = await EventModel.findOne({ id: id, tenantId: tenantId });
    if (!rawEvent) {
      return null;
    }
    return rawEvent.toEntity();
  }

  /**
   * Insert an event object into the database or update it.
   *
   * @param {Event} event The event object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeEvent(event, upsert = true) {
    const eventEntity = event instanceof Event ? event : new Event(event);

    eventEntity.validate();

    await EventModel.updateOne(
      { id: eventEntity.id, tenantId: eventEntity.tenantId },
      eventEntity,
      {
        upsert: upsert,
      },
    );

    return eventEntity;
  }

  /**
   * Remove an event object from the database.
   *
   * @param {string} id The id of the event to remove
   * @param {string} tenantId The tenant of the event to remove
   * @returns Promise<>
   */
  static async removeEvent(id, tenantId) {
    await EventModel.deleteOne({ id: id, tenantId: tenantId });
  }

  /**
   * Checks the current count of events for a specific tenant against the maximum allowed events.
   * The maximum allowed events is defined in the environment variable MAX_EVENTS.
   * If the current count of events is greater than or equal to the maximum allowed events, it returns false.
   * If the current count of events is less than the maximum allowed events, or if MAX_EVENTS is not defined, it returns true.
   *
   * @async
   * @param {string} tenantId - The identifier of the tenant.
   * @returns {Promise<boolean>} A promise that resolves to a boolean indicating whether the tenant can create more events.
   */
  static async checkPublicEventCount(tenantId) {
    const maxEvents = parseInt(process.env.MAX_EVENTS, 10);
    const count = await EventModel.countDocuments({
      tenantId: tenantId,
      isPublic: true,
    });
    return !(maxEvents && count >= maxEvents);
  }
}

module.exports = EventManager;
