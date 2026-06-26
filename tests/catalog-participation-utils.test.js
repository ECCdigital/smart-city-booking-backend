const { expect } = require("chai");
const {
  hasRestrictedCatalogAccess,
  isTenantListedInCatalog,
} = require("../src/commons/utilities/catalog-participation-utils");

describe("catalog-participation-utils", () => {
  const catalog = { excludedTenantIds: ["excluded-tenant"] };

  const publicTenant = {
    id: "public-tenant",
    catalogParticipation: { visible: true, restricted: false },
  };

  const restrictedTenant = {
    id: "restricted-tenant",
    catalogParticipation: { visible: true, restricted: true },
  };

  const hiddenTenant = {
    id: "hidden-tenant",
    catalogParticipation: { visible: false, restricted: false },
  };

  describe("hasRestrictedCatalogAccess", () => {
    it("allows access to unrestricted tenants without membership", () => {
      expect(hasRestrictedCatalogAccess(publicTenant, new Set())).to.equal(true);
    });

    it("denies access to restricted tenants without membership", () => {
      expect(hasRestrictedCatalogAccess(restrictedTenant, new Set())).to.equal(
        false,
      );
    });

    it("allows access to restricted tenants with membership", () => {
      expect(
        hasRestrictedCatalogAccess(
          restrictedTenant,
          new Set(["restricted-tenant"]),
        ),
      ).to.equal(true);
    });
  });

  describe("isTenantListedInCatalog", () => {
    it("excludes tenants that are not visible", () => {
      expect(isTenantListedInCatalog(hiddenTenant, catalog, new Set())).to.equal(
        false,
      );
    });

    it("excludes tenants listed in excludedTenantIds", () => {
      const tenant = {
        id: "excluded-tenant",
        catalogParticipation: { visible: true, restricted: false },
      };

      expect(isTenantListedInCatalog(tenant, catalog, new Set())).to.equal(false);
    });

    it("includes unrestricted visible tenants", () => {
      expect(isTenantListedInCatalog(publicTenant, catalog, new Set())).to.equal(
        true,
      );
    });

    it("excludes restricted tenants without membership", () => {
      expect(
        isTenantListedInCatalog(restrictedTenant, catalog, new Set()),
      ).to.equal(false);
    });

    it("includes restricted tenants with membership", () => {
      expect(
        isTenantListedInCatalog(
          restrictedTenant,
          catalog,
          new Set(["restricted-tenant"]),
        ),
      ).to.equal(true);
    });
  });
});
