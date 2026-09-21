/**
 * The active review queue (glossary "Aktive Prüfliste", tenant supervision
 * spec §6.2): every offer of a supervised tenant that waits for a
 * decision. The selection is exactly
 *
 *   tenant `supervised` AND offer `review.status === "pending"`
 *
 * and nothing else: neither the publication wish nor the date of an event
 * narrows it, so unlisted offers and past events are rows as well.
 *
 * The queue is computed on read and stored nowhere. A resubmission renews
 * `review.submittedAt` and so moves the row to the back; a decision or a
 * level change away from `supervised` removes it; switching the
 * publication wish off changes nothing.
 *
 * Trade-off: bookables and events live in two collections, so one page
 * cannot be cut by the database. The service reads the projected pending
 * rows of both types instance-wide (a handful of fields each, never whole
 * offers), merges them into one order and cuts the page in memory. That
 * keeps `total` exact and the order stable across pages, at the price of
 * reading every waiting row per request - bounded by what instance owners
 * have not decided yet, which is what the queue exists to keep small.
 *
 * The admin link of a row follows one path pattern per offer type, the
 * Admin UI's editor routes (smart-city-booking-vue-app, `router/index.js`),
 * which name the offer in the query:
 *
 *   bookable  /<rooms|resources|tickets|event-locations>/edit?id=<offerId>
 *             (the editor of the bookable's `type`)
 *   event     /events/edit?id=<offerId>
 *
 * The path is relative to the Admin UI and carries no tenant: the Admin UI
 * works in the tenant the row names (`tenantId`). A bookable of a type
 * without an editor has no path (`null`).
 */

const TenantManager = require("../../data-managers/tenant-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const { SUPERVISION_LEVELS, OFFER_TYPES } = require("./supervision-constants");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const BOOKABLE_EDITOR_BY_TYPE = Object.freeze({
  room: "rooms",
  resource: "resources",
  ticket: "tickets",
  "event-location": "event-locations",
  // The schema's older name of an event location.
  location: "event-locations",
});

const editorPath = (editor, offerId) =>
  `/${editor}/edit?id=${encodeURIComponent(offerId)}`;

/**
 * What the queue needs from an offer type: the projected pending offers of
 * a set of tenants, and how one of them reads as a row.
 */
const QUEUE_SOURCES = Object.freeze({
  [OFFER_TYPES.BOOKABLE]: {
    list: (tenantIds) => BookableManager.getPendingReviewOffers(tenantIds),
    title: (bookable) => bookable.title ?? null,
    adminPath: (bookable) => {
      const editor = BOOKABLE_EDITOR_BY_TYPE[bookable.type];
      return editor ? editorPath(editor, bookable.id) : null;
    },
  },
  [OFFER_TYPES.EVENT]: {
    list: (tenantIds) => EventManager.getPendingReviewOffers(tenantIds),
    title: (event) => event.information?.name ?? null,
    adminPath: (event) => editorPath("events", event.id),
  },
});

const time = (date) => (date ? new Date(date).getTime() : 0);
/** Code unit order: the same on every host, whatever its locale. */
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Longest waiting first; offer type and id make the order total. */
function byWaitingTime(a, b) {
  return (
    time(a.submittedAt) - time(b.submittedAt) ||
    compareText(a.offerType, b.offerType) ||
    compareText(a.offerId, b.offerId)
  );
}

class ReviewQueueService {
  /**
   * One page of the active review queue, longest waiting first.
   *
   * @param {Object} [params]
   * @param {string} [params.tenantId] Only the rows of this tenant
   * @param {string} [params.offerType] Only this one of `OFFER_TYPES`
   * @param {number|string} [params.page] 1-based
   * @param {number|string} [params.pageSize] Capped at 200
   * @returns {Promise<{items: Object[], total: number, page: number, pageSize: number}>}
   *   A row is `{ tenantId, tenantName, offerType, offerId, title,
   *   submittedAt, isPublic, adminPath }`
   */
  static async listActiveReviewQueue({
    tenantId,
    offerType,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = {}) {
    const safePage = Math.max(1, Math.floor(Number(page)) || 1);
    const safePageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE),
    );

    const supervised = (
      await TenantManager.getTenants(
        {},
        { supervisionLevel: SUPERVISION_LEVELS.SUPERVISED },
      )
    ).filter((tenant) => !tenantId || tenant.id === tenantId);
    const tenantNames = new Map(
      supervised.map((tenant) => [tenant.id, tenant.name ?? null]),
    );

    const rows = [];
    if (tenantNames.size > 0) {
      const types = offerType ? [offerType] : Object.keys(QUEUE_SOURCES);
      for (const type of types) {
        const source = QUEUE_SOURCES[type];
        const offers = source ? await source.list([...tenantNames.keys()]) : [];
        for (const offer of offers) {
          rows.push({
            tenantId: offer.tenantId,
            tenantName: tenantNames.get(offer.tenantId) ?? null,
            offerType: type,
            offerId: offer.id,
            title: source.title(offer),
            submittedAt: offer.review?.submittedAt ?? null,
            isPublic: offer.isPublic === true,
            adminPath: source.adminPath(offer),
          });
        }
      }
    }
    rows.sort(byWaitingTime);

    const start = (safePage - 1) * safePageSize;
    return {
      items: rows.slice(start, start + safePageSize),
      total: rows.length,
      page: safePage,
      pageSize: safePageSize,
    };
  }
}

module.exports = ReviewQueueService;
