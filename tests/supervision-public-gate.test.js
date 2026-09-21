/**
 * The tenant gate of the supervision on the public delivery paths (tenant
 * supervision spec §5.2, research inventory 01): a blocked tenant's public
 * projection does not exist - single resources answer 404, lists leave it
 * out - while staff keep their management reach and the existing-booking
 * paths, hooks and management routes never change.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const { Catalog } = require("../src/commons/entities/catalog/catalog");

/** Every public delivery path of the inventory that the gate applies to. */
const GATED = [
  `/api/tenants/${TENANT}/payment-apps`,
  `/api/${TENANT}/bookables/public`,
  `/api/${TENANT}/bookables/public/${FIXTURE_ID}`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/bookings?public=true`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/openingHours`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/availability/v1`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/availability/v2`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/availability`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/block-periods`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/occupancy`,
  `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
  `/api/${TENANT}/events`,
  `/api/${TENANT}/events/${FIXTURE_ID}`,
  `/api/${TENANT}/bookings?public=true`,
  `/api/${TENANT}/calendar/occupancy`,
  `/api/${TENANT}/coupons/${FIXTURE_ID}`,
  `/api/${TENANT}/checkout/permissions/${FIXTURE_ID}`,
  `/api/${TENANT}/files/get?name=x.png`,
  `/api/${TENANT}/ical/events`,
  `/api/${TENANT}/ical/events/${FIXTURE_ID}`,
  `/api/${TENANT}/ical/feed/events`,
  `/api/${TENANT}/ical/feed/events/${FIXTURE_ID}`,
  `/api/v2/${TENANT}/coupon/validate/${FIXTURE_ID}`,
  `/api/v2/${TENANT}/media/${FIXTURE_ID}/file`,
  `/api/v2/${TENANT}/checkout/permissions/${FIXTURE_ID}`,
  `/json/${TENANT}/bookables`,
  `/json/${TENANT}/bookables/${FIXTURE_ID}`,
  `/json/${TENANT}/events`,
  `/json/${TENANT}/events/${FIXTURE_ID}`,
  `/html/${TENANT}/bookables`,
  `/html/${TENANT}/bookables/${FIXTURE_ID}`,
  `/html/${TENANT}/events`,
  `/html/${TENANT}/events/${FIXTURE_ID}`,
];

/** Paths the gate leaves alone: existing bookings, management, instance. */
const UNGATED = [
  `/api/${TENANT}/bookings/${FIXTURE_ID}/status/public`,
  `/api/${TENANT}/bookings/${FIXTURE_ID}/status`,
  `/api/v2/${TENANT}/bookings/${FIXTURE_ID}/status`,
  `/api/${TENANT}/bookings/${FIXTURE_ID}/cancellation-refund-preview/public`,
  `/api/instances/public`,
  `/api/holidays`,
];

describe("supervision: the tenant gate on public delivery", function () {
  this.timeout(30000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
          isPublic: true,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
  });

  const get = (path, userId) => {
    let req = h.api().get(path).timeout({ response: 3000 });
    if (userId) req = req.set(h.as(userId));
    return req;
  };

  it("answers 404 for every public delivery path of a blocked tenant", async function () {
    // The answer when free, to tell the gate's 404 from a fixture's. The
    // html event pages hang in the fixture world (pinned as `timeout` in
    // the route snapshot), which is as good as "not 404" here.
    const before = {};
    for (const path of GATED) {
      before[path] = await get(path).then(
        (res) => res.status,
        (err) => (err.timeout ? "timeout" : `error: ${err.message}`),
      );
    }
    h.tenant.supervisionLevel = "blocked";

    const wrong = [];
    for (const path of GATED) {
      const res = await get(path);
      if (res.status !== 404) {
        wrong.push(`${path} -> ${res.status}`);
      } else if (before[path] === 404 || /^error/.test(before[path])) {
        wrong.push(`${path} was ${before[path]} already when free`);
      } else if (JSON.stringify(res.body).includes("supervision")) {
        wrong.push(`${path} names the reason`);
      }
    }
    expect(wrong).to.deep.equal([]);
  });

  it("leaves the existing-booking and instance paths as they were", async function () {
    const before = {};
    for (const path of UNGATED) {
      before[path] = (await get(path)).status;
    }
    h.tenant.supervisionLevel = "blocked";

    for (const path of UNGATED) {
      expect((await get(path)).status, path).to.equal(before[path]);
    }
  });

  it("keeps the management reach of the tenant's staff", async function () {
    h.tenant.supervisionLevel = "blocked";

    expect(
      (await get(`/api/${TENANT}/bookables/${FIXTURE_ID}/prices`, ADMIN))
        .status,
    ).to.equal(200);
    expect(
      (await get(`/api/${TENANT}/ical/events`, ROLE_HOLDER)).status,
    ).to.equal(200);
    expect(
      (await get(`/api/${TENANT}/events/${FIXTURE_ID}`, ROLE_HOLDER)).status,
    ).to.equal(200);
    expect((await get(`/api/${TENANT}/bookables`, OWNER)).status).to.equal(200);
    expect((await get(`/api/tenants/${TENANT}`, OWNER)).status).to.equal(200);
  });

  it("does not turn a failing tenant load into an empty 200", async function () {
    TenantManager.getTenant.rejects(new Error("mongo down"));
    try {
      expect((await get(`/api/${TENANT}/bookables/public`)).status).to.equal(
        500,
      );
    } finally {
      TenantManager.getTenant.resetBehavior();
      TenantManager.getTenant.callsFake(
        async () =>
          new (require("../src/commons/entities/tenant/tenant"))(h.tenant),
      );
    }
  });

  describe("tenant lists and catalog", function () {
    it("leaves blocked tenants out of the public tenant list", async function () {
      const find = sinon.stub(TenantModel, "find").resolves([]);
      try {
        TenantManager.getPublicTenants.restore();
        await TenantManager.getPublicTenants();
        expect(find.firstCall.args[0]).to.deep.equal({
          supervisionLevel: { $ne: "blocked" },
        });
      } finally {
        find.restore();
        sinon.stub(TenantManager, "getPublicTenants").resolves([]);
      }
    });

    it("leaves a blocked tenant out of the catalog bundle", async function () {
      InstanceManager.getPortalConfig.resolves({
        publicOffersEnabled: true,
        portalUrl: "https://portal.example.test",
      });
      CatalogManager.getInstanceCatalog.resolves(
        new Catalog({
          id: "ic",
          slug: "ic",
          name: "Instanz",
          type: "instance",
        }),
      );
      try {
        expect((await get("/api/catalog/bundle")).body.tenants).to.have.length(
          1,
        );
        h.tenant.supervisionLevel = "blocked";
        expect((await get("/api/catalog/bundle")).body.tenants).to.have.length(
          0,
        );
      } finally {
        InstanceManager.getPortalConfig.resolves({
          publicOffersEnabled: false,
        });
      }
    });

    it("answers 404 for the slug and theme of a blocked single-tenant catalog", async function () {
      InstanceManager.getPortalConfig.resolves({
        publicOffersEnabled: true,
        portalUrl: "https://portal.example.test",
      });
      CatalogManager.getCatalogBySlug.resolves(
        new Catalog({
          id: "single",
          slug: "fx-slug",
          name: "Verein",
          type: "single",
          active: true,
          tenantId: TENANT,
        }),
      );
      try {
        expect((await get("/api/catalog/fx-slug")).status).to.equal(200);
        h.tenant.supervisionLevel = "blocked";
        expect((await get("/api/catalog/fx-slug")).status).to.equal(404);
        expect((await get("/api/catalog/themes/fx-slug")).status).to.equal(404);
      } finally {
        InstanceManager.getPortalConfig.resolves({
          publicOffersEnabled: false,
        });
      }
    });
  });
});
