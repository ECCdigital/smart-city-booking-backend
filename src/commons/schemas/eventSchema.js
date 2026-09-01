/**
 * The reference sites of an event are typed as Mixed on purpose: the media
 * spec (§4.8) pins them to the paths the usage search already reads
 * (`information.teaserImage`, `eventOrganizer.contactPersonImage`), and those
 * paths still hold plain URL strings until the media import (B7) converts
 * them. A subdocument type would make every legacy event unreadable; the shape
 * is checked in `Event.validate()` instead. The image list and the photo of
 * every speaker (`images`, `eventOrganizer.speakers[].image`) carry references
 * too and stay untyped arrays for exactly the same reason.
 */
const mediaReferenceSiteDefinition = { type: Object, default: null };

const eventSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  // Attachments carry a media reference under `reference` plus their context
  // fields, the same shape as a bookable attachment. Legacy entries are bare
  // strings or objects with a raw `url` — hence the untyped array.
  attachments: { type: Array, default: [] },
  attendees: {
    publicEvent: { type: Boolean, default: true },
    needsRegistration: { type: Boolean, default: false },
    free: { type: Boolean, default: false },
    maxAttendees: { type: Number, default: null },
    priceCategories: { type: Array, default: [] },
  },
  externalBookingUrl: { type: String, default: "" },
  location: {
    type: Object,
    default: {
      coordinates: {
        type: "Point",
        points: [null, null],
      },
      display_address: "",
      address: {
        street: null,
        house_number: null,
        post_code: null,
        city: null,
        suburb: null,
        state: null,
        country: null,
        country_code: null,
      },
      meta: {},
    },
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
    contactPersonImage: mediaReferenceSiteDefinition,
    speakers: { type: Array, default: [] },
  },
  format: { type: Number, default: 0 },
  images: { type: Array, default: [] },
  information: {
    name: { type: String, default: "" },
    teaserText: { type: String, default: "" },
    description: { type: String, default: "" },
    teaserImage: mediaReferenceSiteDefinition,
    startDate: { type: String, default: null },
    startTime: { type: String, default: null },
    endDate: { type: String, default: null },
    endTime: { type: String, default: null },
    tags: { type: Array, default: [] },
    flags: { type: Array, default: [] },
  },
  isPublic: { type: Boolean, default: false },
  schedules: { type: Array, default: [] },
  ownerUserId: { type: String, default: "" },
};

module.exports = {
  eventSchemaDefinition,
};
