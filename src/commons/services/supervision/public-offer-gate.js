/**
 * The offer gate at the HTTP edge (tenant supervision spec §5.1, §5.2):
 * the detail-type public delivery of one bookable - its detail, prices,
 * opening hours, availability, block periods, occupancy, the permission
 * pre-check of its checkout - answers 404 unless the bookable is
 * reachable, and a ticket unless its event is reachable too. It includes
 * the tenant gate, so a route carries this one instead of
 * `publicTenantGate()`, after its marker. An event's own detail asks
 * `assertOfferReachable` in its handler.
 *
 * Asked only under the reach `public`: staff of the tenant (`own`, `any`)
 * keep their management reach. The 404 names no reason (§5.2).
 */

const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const { NotFoundError } = require("../../../errors/BaseError");
const { REACH } = require("../authorization/policy");
const { isOfferReachable, isOfferListable } = require("./offer-gate");
const { assertTenantPubliclyVisible } = require("./public-tenant-gate");

/**
 * Refuses a bookable the public cannot reach by a direct link. A bookable
 * the tenant does not have passes: the handler answers for it as before.
 *
 * @param {string} tenantId
 * @param {string} bookableId
 * @returns {Promise<void>}
 * @throws {NotFoundError} `tenant_not_found` for a blocked or unknown
 *   tenant, `offer_not_found` for a bookable that is not reachable
 */
async function assertBookableReachable(tenantId, bookableId) {
  const bookable = await BookableManager.getBookable(
    String(bookableId ?? "").trim(),
    tenantId,
  );
  await assertOfferReachable(tenantId, bookable);
}

/**
 * The same question about an offer the caller already holds. No offer
 * (the tenant has none of that id) passes the offer part: the caller
 * answers for it as before.
 *
 * @param {string} tenantId
 * @param {Object|null} offer A bookable or an event of the tenant
 * @returns {Promise<void>}
 * @throws {NotFoundError} `tenant_not_found`, `offer_not_found`
 */
async function assertOfferReachable(tenantId, offer) {
  const tenant = await assertTenantPubliclyVisible(tenantId);
  if (!offer) {
    return;
  }
  // A ticket is reachable with its event only: what booking it needs -
  // detail, prices, availability - follows the event's supervision too.
  const event = await eventOfTicket(offer);
  if (!isOfferReachable({ tenant, offer, event })) {
    throw new NotFoundError("offer_not_found", { id: offer.id });
  }
}

/**
 * The event an offer hangs on: the event of a ticket, null for every
 * other bookable, for an event itself and for a ticket whose event is gone.
 *
 * @param {Object} offer A bookable or an event
 * @returns {Promise<Object|null>}
 */
async function eventOfTicket(offer) {
  if (!hangsOnEvent(offer)) {
    return null;
  }
  return EventManager.getEvent(offer.eventId, offer.tenantId);
}

const hangsOnEvent = (offer) =>
  offer.type === BOOKABLE_TYPES.TICKET && Boolean(offer.eventId);

/**
 * The gate as a middleware for a route that names its tenant `:tenant`
 * and its bookable `:id`. A plain function, as `publicTenantGate()`.
 *
 * @param {Object} [options]
 * @param {string[]} [options.exemptReaches] The reaches the gate lets
 *   through unasked: the management reaches `own` and `any` by default. A
 *   route whose `own` is every signed-in user names `any` alone - signing
 *   in never opens the gate (spec §5.2).
 * @returns {import("express").RequestHandler}
 */
function publicBookableGate({ exemptReaches = [REACH.OWN, REACH.ANY] } = {}) {
  return (req, res, next) => {
    if (exemptReaches.includes(req.reach)) {
      return next();
    }
    assertBookableReachable(req.params?.tenant, req.params?.id)
      .then(() => next())
      .catch(next);
  };
}

/** The bookables of a list-type public delivery (§5.1 "Liste/Katalog"). */
function listableOffers(tenant, offers) {
  return offers.filter((offer) => isOfferListable({ tenant, offer }));
}

/**
 * Leaves the tickets of events the public cannot reach out of a list of
 * bookables that passed the gate themselves (spec §5.2: no leak over
 * embedded objects) - a ticket goes out with its event only. A ticket
 * whose event is gone stays, as on the direct link.
 *
 * @param {Object} tenant
 * @param {Object[]} bookables
 * @returns {Promise<Object[]>}
 */
async function withoutTicketsOfUnreachableEvents(tenant, bookables) {
  if (!bookables.some(hangsOnEvent)) {
    return bookables;
  }
  const events = new Map(
    (await EventManager.getEvents(tenant.id)).map((event) => [event.id, event]),
  );
  return bookables.filter(
    (offer) =>
      !hangsOnEvent(offer) ||
      isOfferReachable({ tenant, offer, event: events.get(offer.eventId) }),
  );
}

/** The offers embedded in a reachable one: what a direct link may show. */
function reachableOffers(tenant, offers) {
  return offers.filter((offer) => isOfferReachable({ tenant, offer }));
}

/**
 * The ids of the bookables of a tenant the public can reach: what an
 * anonymized aggregate over the whole tenant (the public booking list) may
 * name. Tickets follow their event.
 *
 * @param {string} tenantId
 * @returns {Promise<Set<string>>}
 * @throws {NotFoundError} `tenant_not_found` for a blocked or unknown tenant
 */
async function reachableBookableIds(tenantId) {
  const tenant = await assertTenantPubliclyVisible(tenantId);
  const bookables = await BookableManager.getBookables(tenantId);
  const reachable = await withoutTicketsOfUnreachableEvents(
    tenant,
    reachableOffers(tenant, bookables),
  );
  return new Set(reachable.map((bookable) => bookable.id));
}

module.exports = {
  reachableBookableIds,
  assertBookableReachable,
  assertOfferReachable,
  publicBookableGate,
  listableOffers,
  reachableOffers,
  withoutTicketsOfUnreachableEvents,
};
