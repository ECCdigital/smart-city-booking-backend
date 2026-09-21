/**
 * The review of an offer (glossary "Prüfstatus", tenant supervision spec
 * §4, §6.2, §8): the one place a review status changes. `submit` is the
 * tenant's submission (glossary "Einreichung"), `decide` the instance
 * owner's decision (glossary "Prüfentscheidung").
 *
 * The service is generic over the offer type. What it needs from a type
 * is an adapter:
 *
 *   load(tenantId, offerId)
 *     → the offer `{ id, title, isPublic, review }`, or null when the
 *       tenant has none of that id
 *   updateReview({ tenantId, offerId, expectedStatus, review })
 *     → the offer after a write conditional on `review.status ===
 *       expectedStatus` (null matches "none yet"), or null when the status
 *       moved underneath - the write never touches another field
 *
 * Bookables and events are registered at the end of this file. An event
 * has no `title` of its own: its adapter answers `information.name`.
 */

const TenantManager = require("../../data-managers/tenant-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const SupervisionHistoryManager = require("../../data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../../data-managers/supervision-notification-manager");
const {
  SUPERVISION_LEVELS,
  REVIEW_STATUS,
  OFFER_TYPES,
  HISTORY_EVENT_TYPES,
  HISTORY_ACTOR_TYPES,
  HISTORY_ORIGINS,
  NOTIFICATION_TYPES,
  effectiveLevelOf,
} = require("./supervision-constants");
const {
  REVIEW_ACTIONS,
  DECISION_ACTIONS,
  applyReviewTransition,
} = require("./review-transitions");
const {
  BadRequestError,
  NotFoundError,
  ConflictError,
} = require("../../../errors/BaseError");

const HISTORY_EVENT_BY_ACTION = Object.freeze({
  [REVIEW_ACTIONS.SUBMIT]: HISTORY_EVENT_TYPES.REVIEW_SUBMITTED,
  [REVIEW_ACTIONS.APPROVE]: HISTORY_EVENT_TYPES.REVIEW_APPROVED,
  [REVIEW_ACTIONS.REJECT]: HISTORY_EVENT_TYPES.REVIEW_REJECTED,
  [REVIEW_ACTIONS.WITHDRAW]: HISTORY_EVENT_TYPES.REVIEW_WITHDRAWN,
});

const adapters = new Map();

class ReviewService {
  /**
   * Registers the adapter of an offer type (contract: see the file head).
   *
   * @param {string} offerType One of `OFFER_TYPES`
   * @param {{load: Function, updateReview: Function}} adapter
   */
  static registerOfferAdapter(offerType, adapter) {
    if (
      typeof adapter?.load !== "function" ||
      typeof adapter?.updateReview !== "function"
    ) {
      throw new Error(`review: incomplete adapter for ${offerType}`);
    }
    adapters.set(offerType, adapter);
  }

  /**
   * The publication wish of an offer without a review status is its
   * submission (spec §4, §6.1) - whatever the tenant's level. Called by
   * every write that stores an offer with `isPublic`; an offer that has a
   * status keeps it, so switching the wish off and on is no resubmission,
   * and a write repeated after a failed submission submits again.
   *
   * @param {Object} params
   * @param {string} params.offerType One of `OFFER_TYPES`
   * @param {string} params.tenantId
   * @param {{id: string, isPublic: boolean, review?: Object}} params.offer
   *   The offer as it was stored
   * @param {string|null} params.actorUserId
   * @returns {Promise<Object|null>} The review after the submission, or
   *   null when the write is no publication wish to submit
   */
  static async submitOnPublicationWish({
    offerType,
    tenantId,
    offer,
    actorUserId,
  }) {
    if (offer.isPublic !== true || (offer.review?.status ?? null) !== null) {
      return null;
    }
    return ReviewService.submit({
      offerType,
      tenantId,
      offerId: offer.id,
      actorUserId,
    });
  }

  /**
   * Submits an offer for review. A submission on a pending offer is a
   * no-op: nothing is written, the waiting time stays.
   *
   * @param {Object} params
   * @param {string} params.offerType One of `OFFER_TYPES`
   * @param {string} params.tenantId
   * @param {string} params.offerId
   * @param {string|null} params.actorUserId Who submits (server-determined)
   * @param {Date} [params.now] The server time; default: now
   * @returns {Promise<Object>} The review after the submission
   * @throws {NotFoundError} `offer_not_found`
   * @throws {ConflictError} `review_transition_invalid`
   */
  static async submit({ offerType, tenantId, offerId, actorUserId, now }) {
    return ReviewService._apply({
      offerType,
      tenantId,
      offerId,
      action: REVIEW_ACTIONS.SUBMIT,
      actorUserId,
      now,
    });
  }

  /**
   * Decides the review of an offer: `approve`, `reject` or `withdraw`.
   *
   * @param {Object} params As `submit`, plus:
   * @param {string} params.action One of `DECISION_ACTIONS`
   * @param {string|null} [params.reason] Optional reason, stored trimmed
   * @returns {Promise<Object>} The review after the decision
   * @throws {BadRequestError} `invalid_review_action`, `invalid_review_reason`
   * @throws {NotFoundError} `offer_not_found`
   * @throws {ConflictError} `review_transition_invalid` for a transition
   *   the table does not list, or one overtaken by a concurrent decision
   */
  static async decide({
    offerType,
    tenantId,
    offerId,
    action,
    reason,
    actorUserId,
    now,
  }) {
    if (!DECISION_ACTIONS.includes(action)) {
      throw new BadRequestError("invalid_review_action", {
        action,
        allowed: DECISION_ACTIONS,
      });
    }
    return ReviewService._apply({
      offerType,
      tenantId,
      offerId,
      action,
      reason,
      actorUserId,
      now,
    });
  }

  static async _apply({
    offerType,
    tenantId,
    offerId,
    action,
    reason,
    actorUserId,
    now = new Date(),
  }) {
    const adapter = adapters.get(offerType);
    if (!adapter) {
      throw new BadRequestError("invalid_offer_type", { offerType });
    }
    const offer = await adapter.load(tenantId, offerId);
    if (!offer) {
      throw new NotFoundError("offer_not_found", { offerType, id: offerId });
    }

    const from = offer.review?.status ?? null;
    const { review, changed } = applyReviewTransition(offer.review, action, {
      now,
      actorUserId,
      reason,
    });
    if (!changed) {
      return review;
    }

    const updated = await adapter.updateReview({
      tenantId,
      offerId,
      expectedStatus: from,
      review,
    });
    if (!updated) {
      throw new ConflictError("review_transition_invalid", { from, action });
    }

    // History and occasion follow the successful write. No dedupe key: a
    // replayed request finds the status moved and ends as the no-op or the
    // conflict above, never as a second row.
    await SupervisionHistoryManager.insert({
      tenantId,
      offerType,
      offerId,
      eventType: HISTORY_EVENT_BY_ACTION[action],
      occurredAt: now,
      actor: { type: HISTORY_ACTOR_TYPES.USER, userId: actorUserId ?? null },
      from,
      to: review.status,
      reason: review.reason,
      origin: HISTORY_ORIGINS.API,
    });
    await ReviewService._recordOccasion({
      offerType,
      tenantId,
      offer,
      action,
      from,
      review,
      actorUserId,
      now,
    });

    return review;
  }

  /**
   * The notification occasion of a transition (spec §8): a decision always
   * has one for the tenant owners; a submission only when the offer
   * actually entered the active review queue - pending, in a supervised
   * tenant.
   */
  static async _recordOccasion({
    offerType,
    tenantId,
    offer,
    action,
    from,
    review,
    actorUserId,
    now,
  }) {
    const tenant = await TenantManager.getTenant(tenantId);
    const base = { tenantId, createdAt: now };

    if (action !== REVIEW_ACTIONS.SUBMIT) {
      await SupervisionNotificationManager.record({
        ...base,
        type: NOTIFICATION_TYPES.REVIEW_DECIDED,
        payload: {
          tenantName: tenant?.name ?? null,
          offerType,
          offerId: offer.id,
          title: offer.title ?? null,
          action,
          from,
          to: review.status,
          reason: review.reason,
          actorUserId: actorUserId ?? null,
          decidedAt: now,
        },
      });
      return;
    }

    if (
      review.status === REVIEW_STATUS.PENDING &&
      effectiveLevelOf(tenant) === SUPERVISION_LEVELS.SUPERVISED
    ) {
      await SupervisionNotificationManager.record({
        ...base,
        type: NOTIFICATION_TYPES.REVIEW_QUEUE_ENTERED,
        payload: {
          tenantName: tenant?.name ?? null,
          cause: HISTORY_EVENT_TYPES.REVIEW_SUBMITTED,
          offers: [
            {
              offerType,
              offerId: offer.id,
              title: offer.title ?? null,
              submittedAt: review.submittedAt,
              isPublic: offer.isPublic === true,
            },
          ],
        },
      });
    }
  }
}

ReviewService.registerOfferAdapter(OFFER_TYPES.BOOKABLE, {
  load: (tenantId, offerId) => BookableManager.getBookable(offerId, tenantId),
  updateReview: ({ tenantId, offerId, expectedStatus, review }) =>
    BookableManager.updateReview({
      tenantId,
      id: offerId,
      expectedStatus,
      review,
    }),
});

/** An event as the review service reads an offer. */
const eventAsOffer = (event) =>
  event && {
    id: event.id,
    title: event.information?.name ?? null,
    isPublic: event.isPublic,
    review: event.review,
  };

ReviewService.registerOfferAdapter(OFFER_TYPES.EVENT, {
  load: async (tenantId, offerId) =>
    eventAsOffer(await EventManager.getEvent(offerId, tenantId)),
  updateReview: async ({ tenantId, offerId, expectedStatus, review }) =>
    eventAsOffer(
      await EventManager.updateReview({
        tenantId,
        id: offerId,
        expectedStatus,
        review,
      }),
    ),
});

module.exports = ReviewService;
