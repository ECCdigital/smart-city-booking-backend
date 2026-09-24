const { Event } = require("../entities/event/event");
const EventModel = require("./models/eventModel");
const { ownCondition } = require("../services/authorization/reach");
const {
  REVIEW_STATUS,
} = require("../services/supervision/supervision-constants");

/**
 * Data Manager for Event objects.
 */
class EventManager {
  /**
   * Get all events related to a tenant
   * @param {string} tenantId Identifier of the tenant
   * @param {{reach?: string, userId?: string}} [scope] The reach of the
   *   request (authorize spec §4.1): under `own` only the user's own
   * @returns List of events
   */
  static async getEvents(tenantId, scope) {
    const rawEvents = await EventModel.find({
      tenantId: tenantId,
      ...ownCondition("ownerUserId", scope),
    });
    return rawEvents.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific event object from the database.
   *
   * @param {string} id Logical identifier of the event object
   * @param {string} tenantId Identifier of the tenant
   * @param {{reach?: string, userId?: string}} [scope] The reach of the
   *   request (authorize spec §4.1): under `own` only the user's own
   * @returns A single event object
   */
  static async getEvent(id, tenantId, scope) {
    const rawEvent = await EventModel.findOne({
      id: id,
      tenantId: tenantId,
      ...ownCondition("ownerUserId", scope),
    });
    if (!rawEvent) {
      return null;
    }
    return rawEvent.toEntity();
  }

  /**
   * The events of some (tenant, id) references, in one query, whatever
   * their review or their tenant's level - for the core data a ticket
   * booking carries (tenant supervision spec §5.2); the booking exists, so
   * the gate of the offer does not apply, and the caller reads only what it
   * names.
   *
   * @param {Array<{tenantId: string, id: string}>} refs
   * @returns {Promise<Event[]>} The events that exist, in no order
   */
  static async getEventsByIds(refs) {
    const pairs = refs.filter((ref) => ref?.tenantId && ref?.id);
    if (pairs.length === 0) {
      return [];
    }
    // One condition per distinct (tenant, id) pair.
    const unique = new Map(
      pairs.map(({ tenantId, id }) => [`${tenantId}/${id}`, { tenantId, id }]),
    );
    const rawEvents = await EventModel.find({ $or: [...unique.values()] });
    return rawEvents.map((doc) => doc.toEntity());
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

    // The review (glossary "Prüfstatus") belongs to `updateReview` alone
    // once the event exists: a whole-event write carries it on insert
    // only, so an edit or a stale copy never undoes a decision.
    const update = { ...eventEntity };
    const exists = await EventModel.exists({
      id: eventEntity.id,
      tenantId: eventEntity.tenantId,
    });
    if (exists) {
      delete update.review;
    }

    await EventModel.updateOne(
      { id: eventEntity.id, tenantId: eventEntity.tenantId },
      update,
      {
        upsert: upsert,
      },
    );

    return eventEntity;
  }

  /**
   * Writes the review of an event, conditional on the review status it was
   * read at: the write of a review transition (tenant supervision spec
   * §4). Touches no other field - the event's dates included, so an
   * expired event is decided like any other.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.id Event ID
   * @param {string|null} params.expectedStatus The status the transition
   *   starts from; null matches an event without a review as well
   * @param {Object} params.review The review to store
   * @returns {Promise<Event|null>} The event after the write, or null when
   *   no event of the tenant is at the expected status
   */
  static async updateReview({ tenantId, id, expectedStatus, review }) {
    const raw = await EventModel.findOneAndUpdate(
      { id, tenantId, "review.status": expectedStatus ?? null },
      { $set: { review } },
      { new: true },
    );
    return raw ? raw.toEntity() : null;
  }

  /**
   * The events of a tenant at one review status (glossary "Prüfstatus"),
   * whatever their publication wish or dates - the offers a level change
   * or the review queue asks for. Longest waiting first.
   *
   * @param {string} tenantId Identifier of the tenant
   * @param {string|null} status One of `REVIEW_STATUS`; null matches an
   *   event without a review as well
   * @returns {Promise<Event[]>} The events, by `review.submittedAt`
   *   ascending, then by id
   */
  static async getOffersByReviewStatus(tenantId, status) {
    const rawEvents = await EventModel.find({
      tenantId,
      "review.status": status ?? null,
    }).sort({ "review.submittedAt": 1, id: 1 });
    return rawEvents.map((doc) => doc.toEntity());
  }

  /**
   * The events of a set of tenants that wait for a decision (glossary
   * "Aktive Prüfliste"), across tenants and whatever their dates, reduced
   * to what a queue row reads - never the whole event.
   *
   * @param {string[]} tenantIds The tenants to read from
   * @returns {Promise<Array<{id: string, tenantId: string, information: {name: string}, isPublic: boolean, review: Object}>>}
   *   Plain rows, by `review.submittedAt` ascending, then by id
   */
  static async getPendingReviewOffers(tenantIds) {
    return EventModel.find(
      { tenantId: { $in: tenantIds }, "review.status": REVIEW_STATUS.PENDING },
      {
        _id: 0,
        id: 1,
        tenantId: 1,
        "information.name": 1,
        isPublic: 1,
        review: 1,
      },
    )
      .sort({ "review.submittedAt": 1, id: 1 })
      .lean();
  }

  /**
   * How many events a tenant has, whatever their dates, publication wish
   * or review status - the offer count of the tenant approval queue.
   *
   * @param {string} tenantId Identifier of the tenant
   * @returns {Promise<number>}
   */
  static async countEvents(tenantId) {
    return EventModel.countDocuments({ tenantId });
  }

  /**
   * Find the events that reference a medium — teaser image, contact person
   * image, the photo of a speaker, the image list or one of the attachments.
   * The usage proof is searched on demand (§4.7 of the media spec); a medium
   * never carries a back reference.
   *
   * @param {string} tenantId Identifier of the tenant
   * @param {string} mediaId Identifier of the medium
   * @returns {Promise<Array<{id: string, title: string}>>} Usage sites
   */
  static async getMediaUsage(tenantId, mediaId) {
    if (!mediaId) {
      return [];
    }

    const docs = await EventModel.find(
      {
        tenantId: tenantId,
        $or: [
          { "information.teaserImage.mediaId": mediaId },
          { "eventOrganizer.contactPersonImage.mediaId": mediaId },
          { "eventOrganizer.speakers.image.mediaId": mediaId },
          { "images.mediaId": mediaId },
          { "attachments.reference.mediaId": mediaId },
        ],
      },
      { id: 1, "information.name": 1 },
    ).lean();

    return docs.map((doc) => ({
      id: doc.id,
      title: doc.information?.name || "",
    }));
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

  static async reassignOwnerUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await EventModel.updateMany(
      { ownerUserId: previousUserId },
      { $set: { ownerUserId: newUserId } },
      options,
    );
  }
}

module.exports = EventManager;
