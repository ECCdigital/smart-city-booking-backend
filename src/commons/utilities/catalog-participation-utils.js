const MembershipManager = require("../data-managers/membership-manager");
const TenantManager = require("../data-managers/tenant-manager");
const {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} = require("../../errors/BaseError");
const { PUBLIC } = require("../services/authorization/reach");

async function getMemberTenantIds(userId) {
  if (!userId) {
    return new Set();
  }

  const memberships = await MembershipManager.getMembershipsByUserID(userId);
  return new Set(memberships.map((membership) => membership.tenantId));
}

function hasRestrictedCatalogAccess(tenant, memberTenantIds) {
  if (!tenant?.catalogParticipation?.restricted) {
    return true;
  }

  return memberTenantIds.has(tenant.id);
}

/**
 * The catalog participation of a tenant the caller reads as the public
 * (`TenantManager.getTenants(PUBLIC)`, ADR 0003): its own wish to be
 * listed, the catalog's exclusions and its restriction to members. The
 * supervision is not asked here - a tenant without a public projection
 * never reaches this.
 */
function isTenantListedInCatalog(tenant, catalog, memberTenantIds) {
  if (!tenant?.catalogParticipation?.visible) {
    return false;
  }

  if (catalog?.excludedTenantIds?.includes(tenant.id)) {
    return false;
  }

  return hasRestrictedCatalogAccess(tenant, memberTenantIds);
}

/**
 * The tenant behind a public catalog path, as the public sees it (ADR
 * 0003): a tenant without a public projection is not there - the 404
 * names no reason (spec §5.2) - and a restricted participation asks for
 * a membership.
 */
async function enforceTenantCatalogAccess(tenantId, userId) {
  const tenant = await TenantManager.getTenant(tenantId, PUBLIC);
  if (!tenant) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }

  if (!tenant.catalogParticipation?.restricted) {
    return tenant;
  }

  if (!userId) {
    throw new UnauthorizedError("authentication_required", { tenantId });
  }

  const memberTenantIds = await getMemberTenantIds(userId);
  if (!hasRestrictedCatalogAccess(tenant, memberTenantIds)) {
    throw new ForbiddenError("tenant_membership_required", { tenantId });
  }

  return tenant;
}

async function assertCatalogSlugAccess(catalog, userId) {
  if (catalog?.type === "single" && catalog.tenantId) {
    await enforceTenantCatalogAccess(catalog.tenantId, userId);
  }
}

module.exports = {
  getMemberTenantIds,
  hasRestrictedCatalogAccess,
  isTenantListedInCatalog,
  enforceTenantCatalogAccess,
  assertCatalogSlugAccess,
};
