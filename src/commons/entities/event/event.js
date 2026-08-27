const { eventSchemaDefinition } = require("../../schemas/eventSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const {
  absoluteMediaReferenceUrl,
  mediaReferenceUrl,
  toMediaReference,
  validateMediaReference,
} = require("../../services/media/media-reference");
const { ValidationError } = require("../../../errors/ValidationError");

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

    const errors = [
      ["information.teaserImage", this.information?.teaserImage],
      [
        "eventOrganizer.contactPersonImage",
        this.eventOrganizer?.contactPersonImage,
      ],
      ...(this.attachments || []).map((attachment, index) => [
        `attachments.${index}.reference`,
        attachment?.reference,
      ]),
      ...(this.images || []).map((image, index) => [`images.${index}`, image]),
      ...(this.eventOrganizer?.speakers || []).map((speaker, index) => [
        `eventOrganizer.speakers.${index}.image`,
        speaker?.image,
      ]),
    ]
      // A bare string is a legacy plain URL, not a malformed reference — the
      // media import converts those, this check only guards what is typed.
      .filter(([, value]) => value && typeof value === "object")
      .filter(([, value]) => !validateMediaReference(toMediaReference(value)))
      .map(([field]) => ({ field, code: "invalid_custom" }));

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    return true;
  }

  /**
   * The address the teaser image is served under — the derived read field the
   * HTML endpoint and the storefront have always known as `teaserImage`.
   *
   * @returns {string} The URL, empty when the event has no teaser image.
   */
  get teaserImageUrl() {
    return (
      mediaReferenceUrl(this.information?.teaserImage, this.tenantId) || ""
    );
  }

  /**
   * The teaser image as an address that survives leaving the platform — a
   * calendar file is read outside any browser session.
   *
   * @returns {string} The absolute URL, empty when there is no teaser image.
   */
  get teaserImageAbsoluteUrl() {
    return (
      absoluteMediaReferenceUrl(this.information?.teaserImage, this.tenantId) ||
      ""
    );
  }

  /**
   * The address the contact person image is served under.
   *
   * @returns {string} The URL, empty when there is none.
   */
  get contactPersonImageUrl() {
    return (
      mediaReferenceUrl(
        this.eventOrganizer?.contactPersonImage,
        this.tenantId,
      ) || ""
    );
  }

  /**
   * The addresses of the image list, position by position — a plain list, not
   * a gallery with a cover: the title image of an event is and stays the
   * teaser image (§4.8). Positions are kept so the list a caller edits by
   * index is the list it read.
   *
   * @returns {string[]} The URLs, empty strings where a position is empty.
   */
  get imageUrls() {
    return (this.images || []).map(
      (image) => mediaReferenceUrl(image, this.tenantId) || "",
    );
  }

  /**
   * The speakers as they go out: their context fields unchanged, the photo as
   * the address it resolves to.
   *
   * @returns {Object[]} The speakers, each with a derived `image`.
   */
  get speakersWithImageUrls() {
    return (this.eventOrganizer?.speakers || []).map((speaker) => ({
      ...speaker,
      image: mediaReferenceUrl(speaker?.image, this.tenantId) || "",
    }));
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
      location: this.location,
      eventLocation: this.eventLocation,
      // Every image site goes out as the address it resolves to, so the public
      // structure is exactly the one it has always been.
      eventOrganizer: {
        ...this.eventOrganizer,
        contactPersonImage: this.contactPersonImageUrl,
        speakers: this.speakersWithImageUrls,
      },
      format: this.format,
      images: this.imageUrls,
      information: {
        ...this.information,
        teaserImage: this.teaserImageUrl,
      },
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
