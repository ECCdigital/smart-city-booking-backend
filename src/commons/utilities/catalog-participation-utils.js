const MembershipManager = require("../data-managers/membership-manager");
const TenantManager = require("../data-managers/tenant-manager");

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
  if (!tenant) {
    throw { code: 404, message: "Tenant not found" };
  }

  if (!tenant.catalogParticipation?.restricted) {
    return tenant;
  }

  if (!userId) {
    throw {
      code: 401,
      message: "Authentication required to access this catalog.",
    };
  }

  const memberTenantIds = await getMemberTenantIds(userId);
  if (!hasRestrictedCatalogAccess(tenant, memberTenantIds)) {
    throw {
      code: 403,
      message: "Tenant membership required to access this catalog.",
    };
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
