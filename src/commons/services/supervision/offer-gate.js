/**
 * The offer gate (tenant supervision spec §5.1): the pure decisions over a
 * tenant and one of its offers (glossary "Angebot"). Two questions, asked
 * by every public delivery path and by the checkout:
 *
 *   isOfferListable    list, catalog, feed, aggregate - the offer asks to be
 *                      listed (`isPublic`) and the tenant lets it out
 *   isOfferReachable   direct link and a new self-booking - the tenant lets
 *                      it out, `isPublic` is no requirement
 *
 * Both start at the tenant (glossary "Aufsichtsstufe"): a blocked tenant
 * shows nothing, a tenant without a stored level counts as free. The
 * review dimension of a supervised tenant (§5.1, rows 3-5) is
 * `offerPassesReview`.
 */

const {
  SUPERVISION_LEVELS,
  REVIEW_STATUS,
  effectiveLevelOf,
} = require("./supervision-constants");

/**
 * Whether a tenant appears in public tenant lists and lets any offer out.
 *
 * @param {Object|null} tenant
 * @returns {boolean} false for a blocked or unknown tenant
 */
function isTenantPubliclyVisible(tenant) {
  if (!tenant) {
    return false;
  }
  return effectiveLevelOf(tenant) !== SUPERVISION_LEVELS.BLOCKED;
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
 * periods, occupancy and the media it needs.
 *
 * @param {{tenant: Object|null, offer: Object}} params
 * @returns {boolean}
 */
function isOfferReachable({ tenant, offer }) {
  return isTenantPubliclyVisible(tenant) && offerPassesReview(tenant, offer);
}

/**
 * The same tenant question as a query condition, for a list that filters
 * in the database: every tenant that is not blocked, a missing level
 * included.
 *
 * @returns {Object} The condition to spread into a tenant query.
 */
function publicTenantCondition() {
  return { supervisionLevel: { $ne: SUPERVISION_LEVELS.BLOCKED } };
}

module.exports = {
  isTenantPubliclyVisible,
  isOfferListable,
  isOfferReachable,
  publicTenantCondition,
};
