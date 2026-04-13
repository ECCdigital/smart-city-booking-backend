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
  getStartDateTime() {
    const date = this.information?.startDate;
    if (!date) return null;

    const time = this.information?.startTime ?? "00:00";
    return new Date(`${date}T${time}`);
  }

  getEndDateTime() {
    const date = this.information?.endDate;
    if (date) {
      const time = this.information?.endTime ?? "23:59";
      return new Date(`${date}T${time}`);
    }
    return this.getStartDateTime();
  }

  isPast(now = new Date()) {
    const end = this.getEndDateTime();
    if (!end) return false;
    return end < now;
  }

  isFuture(now = new Date()) {
    const start = this.getStartDateTime();
    if (!start) return false;
    return start > now;
  }

  isOngoing(now = new Date()) {
    return !this.isPast(now) && !this.isFuture(now);
  }

  exportPublic() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      attendees: this.attendees,
      eventAddress: this.eventAddress,
      eventLocation: this.eventLocation,
      eventOrganizer: this.eventOrganizer,
      format: this.format,
      images: this.images,
      information: this.information,
      schedules: this.schedules,
      externalBookingUrl: this.externalBookingUrl,
    };
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
