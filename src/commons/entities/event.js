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
   * @param attachments {Array} List of attachments
   * @param attendees {Object} Information about attendees
   * @param eventAddress {Object} Address of the event
   * @param eventLocation {Object} Location of the event
   * @param eventOrganizer {Object} Organizer of the event
   * @param format {number} Format of the event
   * @param images {Array} List of images
   * @param information {Object} Information about the event
   * @param externalBookingUrl {string} URL for external booking
   * @param isPublic {boolean} True, if the event is public
   * @param schedules {Array} List of schedules
   * @param ownerUserId {string} The identifier of the owner user
   */
  constructor({
    id,
    tenantId,
    attachments,
    attendees,
    eventAddress,
    eventLocation,
    eventOrganizer,
    format,
    images,
    information,
    externalBookingUrl,
    isPublic,
    schedules,
    ownerUserId,
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.attachments = attachments;
    this.attendees = attendees;
    this.eventAddress = eventAddress;
    this.eventLocation = eventLocation;
    this.eventOrganizer = eventOrganizer;
    this.format = format;
    this.images = images;
    this.information = information;
    this.externalBookingUrl = externalBookingUrl;
    this.isPublic = isPublic;
    this.schedules = schedules;
    this.ownerUserId = ownerUserId;
  }

  static get schema() {
    return {
      id: { type: String, required: true, unique: true },
      tenantId: { type: String, required: true },
      attachments: { type: Array, default: [] },
      attendees: {
        publicEvent: { type: Boolean, default: true },
        needsRegistration: { type: Boolean, default: false },
        free: { type: Boolean, default: false },
        maxAttendees: { type: Number, default: null },
        priceCategories: { type: Array, default: [] },
      },
      eventAddress: {
        street: { type: String, default: "" },
        houseNumber: { type: String, default: "" },
        additional: { type: String, default: "" },
        city: { type: String, default: "" },
        zip: { type: String, default: "" },
      },
      eventLocation: {
        name: { type: String, default: "" },
        phoneNumber: { type: String, default: "" },
        emailAddress: { type: String, default: "" },
        select: { type: String, default: null },
        room: { type: String, default: null },
        url: { type: String, default: "" },
      },
      eventOrganizer: {
        name: { type: String, default: "" },
        addContactPerson: { type: Boolean, default: true },
        contactPersonName: { type: String, default: "" },
        contactPersonPhoneNumber: { type: String, default: "" },
        contactPersonEmailAddress: { type: String, default: "" },
        contactPersonImage: { type: String, default: "" },
        speakers: { type: Array, default: [] },
      },
      format: { type: Number, default: 0 },
      images: { type: Array, default: [] },
      information: {
        name: { type: String, default: "" },
        teaserText: { type: String, default: "" },
        description: { type: String, default: "" },
        teaserImage: { type: String, default: null },
        startDate: { type: Date, default: null },
        startTime: { type: String, default: null },
        endDate: { type: Date, default: null },
        endTime: { type: String, default: null },
        tags: { type: Array, default: [] },
        flags: { type: Array, default: [] },
      },
      externalBookingUrl: { type: String, default: "" },
      isPublic: { type: Boolean, default: false },
      schedules: { type: Array, default: [] },
      ownerUserId: { type: String, default: "" },
    };
  }
}

module.exports = { Event };
