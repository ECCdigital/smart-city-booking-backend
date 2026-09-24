/**
 * The tenant gate at the HTTP edge (tenant supervision spec §5.2): a
 * tenant at a level without a public projection (pending, declined) is
 * not there for the public. `assertTenantPubliclyVisible`
 * is the question for a service that holds the tenant id;
 * `publicTenantGate()` is the same question as a route middleware, placed
 * after the route's marker on the public delivery paths of the inventory
 * - never blanket on `publicRoute()`: the existing-booking status, the
 * payment callbacks, the hooks and the webhooks keep their behaviour.
 *
 * The middleware asks the public alone in full: staff of the tenant
 * (`own`, `any`) keep their management reach and may prepare a pending
 * tenant - but not a declined one (§5.1, glossary "abgewiesen"): there
 * they get the public's 404, only the instance owner keeps every right.
 * The 404 names no reason (§5.2).
 */

const TenantManager = require("../../data-managers/tenant-manager");
const { NotFoundError } = require("../../../errors/BaseError");
const { REACH } = require("../authorization/policy");
const { isTenantPubliclyVisible } = require("./offer-gate");
const { isDeclined } = require("./supervision-constants");

/**
 * The tenant, when the public may see it.
 *
 * @param {string} tenantId
 * @returns {Promise<Object>} The tenant entity
 * @throws {NotFoundError} `tenant_not_found` for an unknown tenant and one
 *   without a public projection
 */
async function assertTenantPubliclyVisible(tenantId) {
  const tenant = await TenantManager.getTenant(tenantId);
  if (!isTenantPubliclyVisible(tenant)) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
  return tenant;
}

/**
 * Whether the tenant's own people still see its public projection: not
 * when it is declined. An unknown tenant passes, as it does for the staff
 * on every route (the handler answers for it).
 *
 * @param {Object|null} tenant
 * @returns {boolean}
 */
function staffSeesProjection(tenant) {
  return !isDeclined(tenant);
}

/**
 * The staff exemption of the gates, asked for a request whose reach is a
 * management one: the instance owner passes, the tenant's staff pass
 * unless the tenant is declined.
 *
 * @param {import("express").Request} req
 * @returns {Promise<void>}
 * @throws {NotFoundError} `tenant_not_found` for the staff of a declined
 *   tenant - the public's answer, naming no reason
 */
async function assertStaffMaySee(req) {
  if (req.principal?.isInstanceOwner) {
    return;
  }
  const tenantId = req.params?.tenant;
  if (!staffSeesProjection(await TenantManager.getTenant(tenantId))) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
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
 *   not open a pending or declined tenant.
 * @returns {import("express").RequestHandler}
 */
function publicTenantGate({ exemptReaches = [REACH.OWN, REACH.ANY] } = {}) {
  return (req, res, next) => {
    const check = exemptReaches.includes(req.reach)
      ? assertStaffMaySee(req)
      : assertTenantPubliclyVisible(req.params?.tenant);
    check.then(() => next()).catch(next);
  };
}

module.exports = {
  assertTenantPubliclyVisible,
  assertStaffMaySee,
  staffSeesProjection,
  publicTenantGate,
};
