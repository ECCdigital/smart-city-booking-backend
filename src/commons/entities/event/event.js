const { eventSchemaDefinition } = require("../../schemas/eventSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

/**
 * This class represents events of various types. An event is an object that cannot be booked directly,
 * but it is related to something that can be booked. The event itself does not store any booking data.
 */
class Event {
  /**
   * Create a new event object.
   * @param {Object} params Event parameters
   */
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(eventSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  /**
   * Validate the event
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, eventSchemaDefinition);
    return true;
  }

  /**
   * Create a new event
   * @param {Object} params Event parameters
   * @returns {Event} The created event
   */
  static create(params) {
    const event = new Event(params);
    event.validate();
    return event;
  }
}

module.exports = {
  Event,
};
