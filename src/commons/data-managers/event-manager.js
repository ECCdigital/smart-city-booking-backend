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
  static storeEvent(event, upsert = true) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("events")
        .replaceOne({ id: event.id, tenant: event.tenant }, event, {
          upsert: upsert,
        })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
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
}

module.exports = EventManager;
