/**
 * The tenant gate at the HTTP edge (tenant supervision spec §5.2): a
 * blocked tenant has no public projection. `assertTenantPubliclyVisible`
 * is the question for a service that holds the tenant id;
 * `publicTenantGate()` is the same question as a route middleware, placed
 * after the route's marker on the public delivery paths of the inventory
 * - never blanket on `publicRoute()`: the existing-booking status, the
 * payment callbacks, the hooks and the webhooks keep their behaviour.
 *
 * The middleware asks only under the reach `public`: staff of the tenant
 * (`own`, `any`) keep their management reach and may prepare a blocked
 * tenant. The 404 names no reason (§5.2).
 */

const TenantManager = require("../../data-managers/tenant-manager");
const { NotFoundError } = require("../../../errors/BaseError");
const { REACH } = require("../authorization/policy");
const { isTenantPubliclyVisible } = require("./offer-gate");

/**
 * The tenant, when the public may see it.
 *
 * @param {string} tenantId
 * @returns {Promise<Object>} The tenant entity
 * @throws {NotFoundError} `tenant_not_found` for an unknown or blocked tenant
 */
async function assertTenantPubliclyVisible(tenantId) {
  const tenant = await TenantManager.getTenant(tenantId);
  if (!isTenantPubliclyVisible(tenant)) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
  return tenant;
}

/**
 * The gate as a middleware for a route that names its tenant `:tenant`.
 * A plain (non-async) function on purpose: it runs on the plain express
 * routers as on the async ones, and passes its error to `next` itself.
 *
 * @param {Object} [options]
 * @param {string[]} [options.exemptReaches] The reaches the gate lets
 *   through unasked. A route whose answer is a public projection for the
 *   signed-in too (`own: "signedIn"`) exempts `any` only: signing in does
 *   not open a blocked tenant.
 * @returns {import("express").RequestHandler}
 */
function publicTenantGate({ exemptReaches = [REACH.OWN, REACH.ANY] } = {}) {
  return (req, res, next) => {
    if (exemptReaches.includes(req.reach)) {
      return next();
    }
    assertTenantPubliclyVisible(req.params?.tenant)
      .then(() => next())
      .catch(next);
  };
}

module.exports = { assertTenantPubliclyVisible, publicTenantGate };
