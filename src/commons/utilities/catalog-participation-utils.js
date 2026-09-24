const MembershipManager = require("../data-managers/membership-manager");
const TenantManager = require("../data-managers/tenant-manager");
const {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} = require("../../errors/BaseError");
const {
  isTenantPubliclyVisible,
} = require("../services/supervision/offer-gate");

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

function isTenantListedInCatalog(tenant, catalog, memberTenantIds) {
  // The tenant gate of the supervision comes first (spec §5.2): a tenant
  // without a public projection (pending, declined) is not listed, whatever
  // its catalog participation says.
  if (!isTenantPubliclyVisible(tenant)) {
    return false;
  }

  if (!tenant?.catalogParticipation?.visible) {
    return false;
  }

  if (catalog?.excludedTenantIds?.includes(tenant.id)) {
    return false;
  }

  return hasRestrictedCatalogAccess(tenant, memberTenantIds);
}

async function enforceTenantCatalogAccess(tenantId, userId) {
  const tenant = await TenantManager.getTenant(tenantId);
  // A pending or declined tenant answers as an unknown one (spec §5.2): the
  // public response names no reason.
  if (!isTenantPubliclyVisible(tenant)) {
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
