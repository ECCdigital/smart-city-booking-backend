/**
 * This class represents events of various types. An event is an object that cannot be booked directly,
 * but it is related to something that can be booked. The event itself does not store any booking data.
 */
class Event {
  /**
   * Create a new event object.
   *
   * @param id {string} The identifier of the event object
   * @param tenant {string} The identifier of the tenant
   * @param title {string} The event's display name
   * @param timeBegin {Timestamp} Timestamp of the event's beginning
   * @param timeEnd {Timestamp} Timestamp of the event's ending
   * @param hostUserId {string} Identifier of the hosting user
   * @param description {string} A rich text description of the event
   * @param location {string} The event location
   * @param tags {array} Tags used for internal filtering
   * @param flags {array} Flags used for user information
   */
  constructor({
    id,
    tenant,
    title,
    timeBegin,
    timeEnd,
    hostUserId,
    description,
    location,
    tags,
    flags,
  }) {
    this.id = id;
    this.tenant = tenant;
    this.title = title;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.hostUserId = hostUserId;
    this.description = description;
    this.location = location;
    this.tags = tags;
    this.flags = flags;
  }

  static schema() {
    return {
      id: String,
      tenant: String,
      title: String,
      timeBegin: Date,
      timeEnd: Date,
      hostUserId: String,
      description: String,
      location: String,
      tags: [String],
      flags: [String],
    };
  }
}

module.exports = { Event };
