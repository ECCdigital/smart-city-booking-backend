const { Event } = require("../entities/event");

const mongoose = require("mongoose");
const { Schema } = mongoose;

const EventSchema = new Schema(Event.schema());
const EventModel =
  mongoose.models.Event || mongoose.model("Event", EventSchema);

/**
 * Data Manager for Event objects.
 */
class EventManager {
  /**
   * Get all events related to a tenant
   * @param {string} tenant Identifier of the tenant
   * @returns List of bookings
   */
  static async getEvents(tenant) {
    const rawEvents = await EventModel.find({
      tenant: tenant,
    });
    return rawEvents.map((re) => new Event(re));
  }

  /**
   * Get a specific event object from the database.
   *
   * @param {string} id Logical identifier of the event object
   * @param {string} tenant Identifier of the tenant
   * @returns A single event object
   */
  static async getEvent(id, tenant) {
    const rawEvent = await EventModel.findOne({ id: id, tenant: tenant });
    return new Event(rawEvent);
  }

  /**
   * Insert an event object into the database or update it.
   *
   * @param {Event} event The event object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeEvent(event, upsert = true) {
    await EventModel.updateOne({ id: event.id, tenant: event.tenant }, event, {
      upsert: upsert,
    });
  }

  /**
   * Remove an event object from the database.
   *
   * @param {string} id The id of the event to remove
   * @param {string} tenant The tenant of the event to remove
   * @returns Promise<>
   */
  static async removeEvent(id, tenant) {
    await EventModel.deleteOne({ id: id, tenant: tenant });
  }

  /**
   * Checks the current count of events for a specific tenant against the maximum allowed events.
   * The maximum allowed events is defined in the environment variable MAX_EVENTS.
   * If the current count of events is greater than or equal to the maximum allowed events, it returns false.
   * If the current count of events is less than the maximum allowed events, or if MAX_EVENTS is not defined, it returns true.
   *
   * @async
   * @param {string} tenant - The identifier of the tenant.
   * @returns {Promise<boolean>} A promise that resolves to a boolean indicating whether the tenant can create more events.
   */
  static async checkPublicEventCount(tenant) {
    const maxEvents = parseInt(process.env.MAX_EVENTS, 10);
    const count = await EventModel.countDocuments({
      tenant: tenant,
      isPublic: true,
    });
    return !(maxEvents && count >= maxEvents);
  }
}

module.exports = EventManager;
