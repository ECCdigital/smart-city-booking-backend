/**
 * The supervision history (glossary "Aufsichtshistorie") as the routes
 * answer it: the stored rows of a page, each with the current title of
 * the offer it names (`offerTitle`). The row stores the offer by type and
 * id only, so the title is read per page - one query per offer type and
 * tenant. A row without an offer, or of an offer that is gone, carries
 * `offerTitle: null`.
 */

const SupervisionHistoryManager = require("../../data-managers/supervision-history-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const { OFFER_TYPES } = require("./supervision-constants");
const { DOMAIN } = require("../authorization/reach");

const keyOf = (tenantId, id) => `${tenantId}/${id}`;

/**
 * Per offer type: the offers of some (tenant, id) references, and the
 * title of one, as the review queue names them.
 */
const OFFER_SOURCES = Object.freeze({
  [OFFER_TYPES.BOOKABLE]: {
    read: async (refs) => {
      const byTenant = new Map();
      for (const { tenantId, id } of refs) {
        byTenant.set(tenantId, [...(byTenant.get(tenantId) ?? []), id]);
      }
      const bookables = [];
      for (const [tenantId, ids] of byTenant) {
        bookables.push(
          ...(await BookableManager.getBookablesByIds(tenantId, ids, DOMAIN)),
        );
      }
      return bookables;
    },
    title: (bookable) => bookable.title || null,
  },
  [OFFER_TYPES.EVENT]: {
    read: (refs) => EventManager.getEventsByIds(refs, DOMAIN),
    title: (event) => event.information?.name || null,
  },
});

class SupervisionHistoryService {
  /**
   * One page of the history, newest first, each row with `offerTitle`.
   *
   * @param {Object} [params] As of `SupervisionHistoryManager.list`
   * @returns {Promise<{items: Object[], total: number, page: number, pageSize: number}>}
   */
  static async list(params) {
    const result = await SupervisionHistoryManager.list(params);

    const titles = new Map();
    for (const [offerType, source] of Object.entries(OFFER_SOURCES)) {
      const refs = result.items
        .filter((row) => row.offerType === offerType && row.offerId)
        .map((row) => ({ tenantId: row.tenantId, id: row.offerId }));
      if (refs.length === 0) continue;
      for (const offer of await source.read(refs)) {
        titles.set(
          `${offerType}:${keyOf(offer.tenantId, offer.id)}`,
          source.title(offer),
        );
      }
    }

    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        offerTitle:
          titles.get(`${row.offerType}:${keyOf(row.tenantId, row.offerId)}`) ??
          null,
      })),
    };
  }
}

module.exports = SupervisionHistoryService;
