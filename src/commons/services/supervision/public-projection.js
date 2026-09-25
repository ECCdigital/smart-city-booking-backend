/**
 * The public projection of the offers (tenant supervision spec §5.1, ADR
 * 0003): what the public sees of a tenant's offers, asked by the managers
 * under the reach `public` and by nobody else. Two questions, one per
 * delivery form:
 *
 *   listed    lists, catalog, feeds, calendar and occupancy aggregates,
 *             embedded lists - the offer asks to be listed (`isPublic`)
 *             and the tenant lets it out
 *   reached   a direct link and a new self-booking - the tenant lets it
 *             out, `isPublic` is no requirement
 *
 * A list method of a manager projects with `listed`, a method that names
 * an id with `reached` (ADR 0003, decision 2). Both load the tenant once
 * and refuse a tenant without a public projection - pending, declined,
 * unknown - with `tenant_not_found`, so a handler that reads through a
 * manager gets the public's 404 without a gate of its own. A ticket goes
 * out with its event only (§5.2: no leak over embedded objects): the
 * events of the tenant are loaded once per call, and only when a ticket
 * is among the offers. What leaves is the entity as the manager read it,
 * without its review (glossary "Prüfstatus"): the module decides records,
 * not fields, and the review is the one field it removes - once, here,
 * so no public answer carries a status or a private reason and asking
 * twice answers the same. Nothing outside this module asks the offer
 * gate - the media rights ask `reached` too: a handler that reads through a manager
 * under `public` inherits the projection without a line of its own.
 *
 * The rules themselves are `offer-gate.js`; this module applies them.
 */

const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const { NotFoundError } = require("../../../errors/BaseError");
const { DOMAIN } = require("../authorization/reach");
const {
  isTenantPubliclyVisible,
  isOfferListable,
  isOfferReachable,
} = require("./offer-gate");
const { PUBLIC_SUPERVISION_LEVELS } = require("./supervision-constants");

/**
 * The offers of a tenant the public sees in a list.
 *
 * @param {string} tenantId
 * @param {Object[]} offers Bookables or events of the tenant
 * @returns {Promise<Object[]>} The listed offers
 * @throws {NotFoundError} `tenant_not_found` for a tenant without a
 *   public projection
 */
async function listed(tenantId, offers) {
  return project(tenantId, offers, isOfferListable);
}

/**
 * The offers of a tenant the public reaches by a direct link and may
 * book anew.
 *
 * @param {string} tenantId
 * @param {Object[]} offers Bookables or events of the tenant
 * @returns {Promise<Object[]>} The reached offers
 * @throws {NotFoundError} `tenant_not_found` for a tenant without a
 *   public projection
 */
async function reached(tenantId, offers) {
  return project(tenantId, offers, isOfferReachable);
}

// The managers of the tenant and the events ask this module in turn, so
// they are loaded when first asked, not when this module is.
const managers = () => ({
  TenantManager: require("../../data-managers/tenant-manager"),
  EventManager: require("../../data-managers/event-manager"),
});

async function project(tenantId, offers, passes) {
  const { TenantManager, EventManager } = managers();
  const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
  if (!isTenantPubliclyVisible(tenant)) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
  const events = offers.some(hangsOnEvent)
    ? new Map(
        (await EventManager.getEvents(tenantId, DOMAIN)).map((event) => [
          event.id,
          event,
        ]),
      )
    : new Map();
  return offers
    .filter(
      (offer) =>
        passes({ tenant, offer }) &&
        // The ticket's event: it has to be reachable too, and a ticket
        // whose event is gone passes the event part.
        (!hangsOnEvent(offer) ||
          isOfferReachable({
            tenant,
            offer,
            event: events.get(offer.eventId) ?? null,
          })),
    )
    .map(withoutReview);
}

const hangsOnEvent = (offer) =>
  offer?.type === BOOKABLE_TYPES.TICKET && Boolean(offer.eventId);

/**
 * The offer as the public gets it: the same entity, without its review.
 * A copy, so the record the manager read keeps what the review service
 * wrote; the same prototype, so the handlers' entity methods still work.
 */
function withoutReview(offer) {
  const copy = Object.assign(
    Object.create(Object.getPrototypeOf(offer)),
    offer,
  );
  delete copy.review;
  return copy;
}

/**
 * The tenants the public sees, as a query condition for a list that
 * filters in the database: every tenant at a public level, a missing
 * level included (`null` in `$in` matches a missing field).
 *
 * @returns {Object} The condition to spread into a tenant query.
 */
function publicTenantCondition() {
  return { supervisionLevel: { $in: [...PUBLIC_SUPERVISION_LEVELS, null] } };
}

module.exports = { listed, reached, publicTenantCondition };
