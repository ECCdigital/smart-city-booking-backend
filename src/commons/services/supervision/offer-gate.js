/**
 * The offer gate (tenant supervision spec §5.1): the pure decisions over a
 * tenant and one of its offers (glossary "Angebot"). The rule layer under
 * the public projection (`public-projection.js`, ADR 0003), which the
 * managers apply under the reach `public` - no handler, engine or
 * checkout asks here; the media access asks for what holds a medium
 * (ticket 04). Two questions:
 *
 *   isOfferListable    list, catalog, feed, aggregate - the offer asks to be
 *                      listed (`isPublic`) and the tenant lets it out
 *   isOfferReachable   direct link and a new self-booking - the tenant lets
 *                      it out, `isPublic` is no requirement
 *
 * Both start at the tenant (glossary "Aufsichtsstufe"): only a tenant at a
 * public level (`PUBLIC_SUPERVISION_LEVELS`: free, supervised) shows
 * anything - a pending (glossary "Freigabe ausstehend") and a declined
 * (glossary "abgewiesen") tenant are, to the public, the same absence. A
 * tenant without a stored level counts as free. The review dimension of a
 * supervised tenant (§5.1, rows 3-5) is `offerPassesReview`.
 */

const {
  SUPERVISION_LEVELS,
  PUBLIC_SUPERVISION_LEVELS,
  REVIEW_STATUS,
  effectiveLevelOf,
} = require("./supervision-constants");

/**
 * Whether a tenant appears in public tenant lists and lets any offer out.
 *
 * @param {Object|null} tenant
 * @returns {boolean} false for an unknown tenant and for one at a level
 *   that is not public
 */
function isTenantPubliclyVisible(tenant) {
  if (!tenant) {
    return false;
  }
  return PUBLIC_SUPERVISION_LEVELS.includes(effectiveLevelOf(tenant));
}

/**
 * The review dimension of the gate (§5.1, rows 3-5): a free tenant needs
 * no review, whatever status is stored; under `supervised` an offer
 * passes only with an approved review status (glossary "Prüfstatus") -
 * none, pending and rejected do not, for list and direct link alike.
 *
 * @param {Object} tenant - A tenant that is publicly visible.
 * @param {Object} offer - A bookable or an event.
 * @returns {boolean}
 */
function offerPassesReview(tenant, offer) {
  if (effectiveLevelOf(tenant) !== SUPERVISION_LEVELS.SUPERVISED) {
    return true;
  }
  return offer?.review?.status === REVIEW_STATUS.APPROVED;
}

/**
 * Whether an offer goes out on list-type delivery: public lists, catalog
 * bundles, feeds, calendar and occupancy aggregates, tag and counter
 * aggregates.
 *
 * @param {{tenant: Object|null, offer: Object}} params
 * @returns {boolean}
 */
function isOfferListable({ tenant, offer }) {
  return (
    isTenantPubliclyVisible(tenant) &&
    offer?.isPublic === true &&
    offerPassesReview(tenant, offer)
  );
}

/**
 * Whether an offer is reachable by a known direct link and bookable in a
 * new self-booking: its detail, prices, opening hours, availability, block
 * periods, occupancy and the media it needs. A ticket hangs on its event:
 * whoever holds the event passes it, and both have to pass.
 *
 * @param {Object} params
 * @param {Object|null} params.tenant
 * @param {Object} params.offer
 * @param {Object|null} [params.event] The event of a ticket, if it has one
 * @returns {boolean}
 */
function isOfferReachable({ tenant, offer, event = null }) {
  return (
    isTenantPubliclyVisible(tenant) &&
    offerPassesReview(tenant, offer) &&
    (!event || offerPassesReview(tenant, event))
  );
}

module.exports = {
  isTenantPubliclyVisible,
  isOfferListable,
  isOfferReachable,
};
