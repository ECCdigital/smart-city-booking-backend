const { v4: uuidv4 } = require("uuid");
const { Event } = require("../entities/event/event");
const { Bookable } = require("../entities/bookable/bookable");
const EventManager = require("../data-managers/event-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const ReviewService = require("./supervision/review-service");
const { OFFER_TYPES } = require("./supervision/supervision-constants");
const { emptyReview } = require("./supervision/review-transitions");

class EventService {
  static async createEvent(tenantId, rawEvent, user, withTickets = false) {
    const event = new Event(rawEvent);

    event.id = uuidv4();
    event.ownerUserId = user?.id;
    // The review is the review service's alone (supervision spec §3).
    event.review = emptyReview();

    await EventManager.storeEvent(event);
    await EventService.submitPublicationWish(tenantId, event, user?.id);
    if (withTickets) {
      const ticket = new Bookable({
        tenantId: tenantId,
        eventId: event.id,
        id: uuidv4(),
        ownerUserId: user?.id,
        type: "ticket",
        title: event.information.name,
        description: event.information.teaserText,
        isBookable: true,
        isPublic: true,
        autoCommitBooking: true,
      });
      await BookableManager.storeBookable(ticket);
      // The ticket is created with a publication wish: its submission
      // (tenant supervision spec §4).
      await ReviewService.submitOnPublicationWish({
        offerType: OFFER_TYPES.BOOKABLE,
        tenantId,
        offer: ticket,
        actorUserId: user?.id ?? null,
      });
    }
  }

  /**
   * Stores an edited event. The review is the review service's alone
   * (supervision spec §3): the edit keeps the stored one, whatever the
   * body carried, and an `isPublic` toggle is no transition.
   *
   * @param {string} tenantId
   * @param {Event} event The edited event
   * @param {Event} existingEvent The event as stored
   * @param {string|null} actorUserId Who edits (server-determined)
   */
  static async updateEvent(tenantId, event, existingEvent, actorUserId) {
    event.review = existingEvent.review ?? emptyReview();
    await EventManager.storeEvent(event);
    await EventService.submitPublicationWish(tenantId, event, actorUserId);
  }

  /**
   * Hands a stored event's publication wish to the review (tenant
   * supervision spec §4, §6.1) and carries the resulting review.
   *
   * @param {string} tenantId
   * @param {Event} event The stored event, its review updated in place
   * @param {string|null} actorUserId
   */
  static async submitPublicationWish(tenantId, event, actorUserId) {
    const review = await ReviewService.submitOnPublicationWish({
      offerType: OFFER_TYPES.EVENT,
      tenantId,
      offer: event,
      actorUserId: actorUserId ?? null,
    });
    if (review) {
      event.review = review;
    }
  }
}

module.exports = EventService;
