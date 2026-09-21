/**
 * The offer gate at the HTTP edge (tenant supervision spec §5.1, §5.2),
 * for bookables: the detail-type public delivery of one bookable - its
 * detail, prices, opening hours, availability, block periods, occupancy,
 * the permission pre-check of its checkout - answers 404 unless the
 * bookable is reachable. It includes the tenant gate, so a route carries
 * this one instead of `publicTenantGate()`, after its marker.
 *
 * Asked only under the reach `public`: staff of the tenant (`own`, `any`)
 * keep their management reach. The 404 names no reason (§5.2).
 */

const { BookableManager } = require("../../data-managers/bookable-manager");
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
 *   tenant, `bookable_not_found` for a bookable that is not reachable
 */
async function assertBookableReachable(tenantId, bookableId) {
  const tenant = await assertTenantPubliclyVisible(tenantId);
  const bookable = await BookableManager.getBookable(
    String(bookableId ?? "").trim(),
    tenantId,
  );
  if (bookable && !isOfferReachable({ tenant, offer: bookable })) {
    throw new NotFoundError("bookable_not_found", { id: bookableId });
  }
}

/**
 * The gate as a middleware for a route that names its tenant `:tenant`
 * and its bookable `:id`. A plain function, as `publicTenantGate()`.
 *
 * @returns {import("express").RequestHandler}
 */
function publicBookableGate() {
  return (req, res, next) => {
    if (req.reach !== REACH.PUBLIC) {
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

/** The offers embedded in a reachable one: what a direct link may show. */
function reachableOffers(tenant, offers) {
  return offers.filter((offer) => isOfferReachable({ tenant, offer }));
}

module.exports = {
  assertBookableReachable,
  publicBookableGate,
  listableOffers,
  reachableOffers,
};
