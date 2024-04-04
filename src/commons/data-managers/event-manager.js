var validate = require("jsonschema").validate;

const { Event } = require("../entities/event");
var dbm = require("../utilities/database-manager");

/**
 * Data Manager for Event objects.
 */
class EventManager {
  /**
   * Check if an object is a valid Event.
   *
   * @param {object} event A event object
   * @returns true, if the object is a valid event object
   */
  static validateEvent(event) {
    var schema = require("../schemas/event.schema.json");
    return validate(event, schema).errors.length == 0;
  }

  /**
   * Get all events related to a tenant
   * @param {string} tenant Identifier of the tenant
   * @returns List of bookings
   */
  static getEvents(tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("events")
        .find({ tenant: tenant })
        .toArray()
        .then((rawEvents) => {
          var events = rawEvents.map((rb) => {
            var event = Object.assign(new Event(), rb);
            return event;
          });

          resolve(events);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get a specific event object from the database.
   *
   * @param {string} id Logical identifier of the event object
   * @param {string} tenant Identifier of the tenant
   * @returns A single event object
   */
  static getEvent(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("events")
        .findOne({ id: id, tenant: tenant })
        .then((rawEvent) => {
          var event = Object.assign(new Event(), rawEvent);
          resolve(event);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Insert an event object into the database or update it.
   *
   * @param {Event} event The event object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeEvent(event, upsert = true) {
    try {
      const eventsCollection = dbm.get().collection("events");
      const existingEvents = await eventsCollection.findOne({
        id: event.id,
        tenant: event.tenant,
      });

      if (!existingEvents) {
        if ((await this.checkEventCount(event.tenant)) === false) {
          throw new Error(`Maximum number of events reached.`);
        }
      }

      await eventsCollection.replaceOne(
        { id: event.id, tenant: event.tenant },
        event,
        {
          upsert: upsert,
        },
      );
    } catch (err) {
      throw new Error(`Error storing event: ${err.message}`);
    }
  }

  /**
   * Remove an event object from the database.
   *
   * @param {Event} event The event object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static removeEvent(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("events")
        .deleteOne({ id: id, tenant: tenant })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
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
  static async checkEventCount(tenant) {
    const maxEvents = parseInt(process.env.MAX_EVENTS, 10);
    const count = await dbm.get().collection("events").countDocuments({ tenant: tenant });
    return !(maxEvents && count >= maxEvents);
  }
}

module.exports = EventManager;
