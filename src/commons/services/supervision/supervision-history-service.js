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
const { OFFER_TYPES, offerTitleOf } = require("./supervision-constants");
const { DOMAIN } = require("../authorization/reach");

const keyOf = (offerType, tenantId, id) => `${offerType}:${tenantId}/${id}`;

/** Per offer type: the offers of some (tenant, id) references. */
const OFFER_READS = Object.freeze({
  [OFFER_TYPES.BOOKABLE]: async (refs) => {
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
  [OFFER_TYPES.EVENT]: (refs) => EventManager.getEventsByIds(refs, DOMAIN),
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
    for (const [offerType, read] of Object.entries(OFFER_READS)) {
      const refs = result.items
        .filter((row) => row.offerType === offerType && row.offerId)
        .map((row) => ({ tenantId: row.tenantId, id: row.offerId }));
      if (refs.length === 0) continue;
      for (const offer of await read(refs)) {
        titles.set(
          keyOf(offerType, offer.tenantId, offer.id),
          offerTitleOf(offerType, offer),
        );
      }
    }

    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        offerTitle:
          titles.get(keyOf(row.offerType, row.tenantId, row.offerId)) ?? null,
      })),
    };
  }
}

module.exports = SupervisionHistoryService;
