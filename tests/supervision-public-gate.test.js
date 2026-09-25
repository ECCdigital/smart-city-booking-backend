/**
 * The public delivery paths of a tenant without a public projection
 * (tenant supervision spec §5.2, research inventory 01, ADR 0003): a
 * pending or declined tenant is not there for the public - single
 * resources answer 404, lists leave it out - without a gate of its own:
 * every path reads through a manager as the public. Staff keep their
 * management view where the entry gives them `any`, and the
 * existing-booking paths, hooks and management routes never change.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  CUSTOMER,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const { PUBLIC } = require("../src/commons/services/authorization/reach");
const {
  isTenantPubliclyVisible,
} = require("../src/commons/services/supervision/offer-gate");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const { Catalog } = require("../src/commons/entities/catalog/catalog");

/** Every public delivery path of the inventory, each the public's 404. */
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

describe("supervision: the public delivery of a tenant without a projection", function () {
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

  // The two levels without a public projection: to the public, a pending
  // (glossary "Freigabe ausstehend") and a declined (glossary "abgewiesen")
  // tenant are the same absence.
  const HIDDEN_LEVELS = ["pending", "declined"];

  it("answers 404 for every public delivery path of a pending and of a declined tenant", async function () {
    // The answer when free, to tell the public's 404 from a fixture's.
    const before = {};
    for (const path of GATED) {
      before[path] = await get(path).then(
        (res) => res.status,
        (err) => (err.timeout ? "timeout" : `error: ${err.message}`),
      );
    }

    const wrong = [];
    for (const level of HIDDEN_LEVELS) {
      h.tenant.supervisionLevel = level;
      for (const path of GATED) {
        const res = await get(path);
        if (res.status !== 404) {
          wrong.push(`${level}: ${path} -> ${res.status}`);
        } else if (before[path] === 404 || /^error/.test(before[path])) {
          wrong.push(`${path} was ${before[path]} already when free`);
        } else if (JSON.stringify(res.body).includes("supervision")) {
          wrong.push(`${level}: ${path} names the reason`);
        }
      }
    }
    expect(wrong).to.deep.equal([]);
  });

  for (const level of HIDDEN_LEVELS) {
    it(`does not open the public booking projection of a ${level} tenant by signing in, nor for the staff`, async function () {
      h.tenant.supervisionLevel = level;
      const path = `/api/${TENANT}/bookings?public=true`;

      expect((await get(path, CUSTOMER)).status).to.equal(404);
      // `?public=true` is the public's view, whoever asks (ADR 0003: a
      // handler asks narrower than its right); the management list is
      // the staff's without the flag.
      expect((await get(path, ADMIN)).status).to.equal(404);
      expect((await get(`/api/${TENANT}/bookings`, ADMIN)).status).to.equal(
        200,
      );
    });

    it(`keeps the tags of a ${level} tenant from a signed-in user outside the tenant`, async function () {
      h.bookables[FIXTURE_ID].tags = ["sauna"];
      const path = `/api/${TENANT}/bookables/_meta/tags`;

      expect((await get(path, CUSTOMER)).body).to.deep.equal(["sauna"]);
      expect((await get(path)).body).to.deep.equal(["sauna"]);
      h.tenant.supervisionLevel = level;
      // The public's aggregate of a tenant without a projection: the
      // public's 404, signed in or not; the staff's `any` reads it whole.
      expect((await get(path, CUSTOMER)).status).to.equal(404);
      expect((await get(path)).status).to.equal(404);
      expect((await get(path, ADMIN)).body).to.deep.equal(["sauna"]);
    });

    it(`leaves the existing-booking and instance paths of a ${level} tenant as they were`, async function () {
      const before = {};
      for (const path of UNGATED) {
        before[path] = (await get(path)).status;
      }
      h.tenant.supervisionLevel = level;

      for (const path of UNGATED) {
        expect((await get(path)).status, path).to.equal(before[path]);
      }
    });
  }

  // The staff's management view (spec §5.1, ADR 0003): the tenant's own
  // people read a pending tenant's offers whole where the entry gives
  // them `any` (preparation), not a declined one's - there their
  // membership rests and they get the public's 404. The instance owner
  // keeps every right. The plainly public paths (the engines, the
  // checkout pre-check, the payment apps) ask everyone as the public.
  const STAFF_PATHS = [
    `/api/${TENANT}/bookables/public`,
    `/api/${TENANT}/bookables/public/${FIXTURE_ID}`,
    `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
    `/api/${TENANT}/events`,
    `/api/${TENANT}/events/${FIXTURE_ID}`,
    `/api/${TENANT}/calendar/occupancy`,
  ];
  // The public calendar (`/ical/events` without `includePrivate`) is asked
  // as the public by everyone, staff included (ADR 0003): of a tenant
  // without a public projection it is the public's 404.
  const PUBLIC_CALENDAR = `/api/${TENANT}/ical/events`;

  it("keeps the management view of a pending tenant's staff on the public paths with `any`", async function () {
    h.tenant.supervisionLevel = "pending";
    h.bookables[FIXTURE_ID].tags = ["sauna"];

    const wrong = [];
    for (const userId of [OWNER, ROLE_HOLDER, ADMIN]) {
      for (const path of STAFF_PATHS) {
        const res = await get(path, userId);
        if (res.status !== 200) {
          wrong.push(`${path} as ${userId} -> ${res.status}`);
        }
      }
    }
    expect(wrong).to.deep.equal([]);
    for (const userId of [OWNER, ROLE_HOLDER, ADMIN]) {
      expect((await get(PUBLIC_CALENDAR, userId)).status, userId).to.equal(404);
      expect(
        (await get(`${PUBLIC_CALENDAR}?includePrivate=true`, userId)).status,
        userId,
      ).to.equal(200);
    }
    expect(
      (await get(`/api/${TENANT}/bookables/_meta/tags`, OWNER)).body,
    ).to.deep.equal(["sauna"]);
    expect((await get(`/api/${TENANT}/bookables`, OWNER)).status).to.equal(200);
    expect((await get(`/api/tenants/${TENANT}`, OWNER)).status).to.equal(200);
    // The engines ask everyone as the public (`html`, `json`: no `any`).
    for (const path of [
      `/json/${TENANT}/bookables`,
      `/html/${TENANT}/bookables`,
    ]) {
      expect((await get(path, OWNER)).status, path).to.equal(404);
    }
  });

  it("gives a declined tenant's staff the public's 404 on the public paths, the instance owner not", async function () {
    h.tenant.supervisionLevel = "declined";
    h.bookables[FIXTURE_ID].tags = ["sauna"];

    const wrong = [];
    for (const userId of [OWNER, ROLE_HOLDER]) {
      for (const path of STAFF_PATHS) {
        const res = await get(path, userId);
        if (res.status !== 404) {
          wrong.push(`${path} as ${userId} -> ${res.status}`);
        } else if (JSON.stringify(res.body).includes("supervision")) {
          wrong.push(`${path} as ${userId} names the reason`);
        }
      }
    }
    for (const path of STAFF_PATHS) {
      const res = await get(path, ADMIN);
      if (res.status !== 200) {
        wrong.push(`${path} as the instance owner -> ${res.status}`);
      }
    }
    expect(wrong).to.deep.equal([]);
    expect(
      (await get(`/api/${TENANT}/bookables/_meta/tags`, OWNER)).status,
    ).to.equal(404);
    expect(
      (await get(`/api/${TENANT}/bookables/_meta/tags`, ADMIN)).body,
    ).to.deep.equal(["sauna"]);
  });

  it("does not turn a failing tenant load into an empty 200", async function () {
    TenantManager.getTenant.rejects(new Error("mongo down"));
    try {
      expect((await get(`/api/${TENANT}/bookables/public`)).status).to.equal(
        500,
      );
    } finally {
      // The route world's read again: the tenant, and under `public` only
      // one with a public projection.
      TenantManager.getTenant.resetBehavior();
      TenantManager.getTenant.callsFake(async (id, scope) => {
        const entity = new (require("../src/commons/entities/tenant/tenant"))(
          h.tenant,
        );
        return scope?.reach === "public" && !isTenantPubliclyVisible(entity)
          ? null
          : entity;
      });
    }
  });

  describe("tenant lists and catalog", function () {
    it("lists only the tenants at a public level, a missing level counting as free", async function () {
      const find = sinon.stub(TenantModel, "find").resolves([]);
      try {
        // The real manager, behind the route world's stub.
        await TenantManager.getTenants.wrappedMethod.call(
          TenantManager,
          PUBLIC,
        );
        expect(find.firstCall.args[0]).to.deep.equal({
          supervisionLevel: { $in: ["free", "supervised", null] },
        });
      } finally {
        find.restore();
      }
    });

    it("leaves a pending and a declined tenant out of the catalog bundle", async function () {
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
        for (const level of HIDDEN_LEVELS) {
          h.tenant.supervisionLevel = level;
          expect(
            (await get("/api/catalog/bundle")).body.tenants,
            level,
          ).to.have.length(0);
        }
      } finally {
        InstanceManager.getPortalConfig.resolves({
          publicOffersEnabled: false,
        });
      }
    });

    it("answers 404 for the slug and theme of a pending or declined single-tenant catalog", async function () {
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
        for (const level of HIDDEN_LEVELS) {
          h.tenant.supervisionLevel = level;
          expect((await get("/api/catalog/fx-slug")).status, level).to.equal(
            404,
          );
          expect(
            (await get("/api/catalog/themes/fx-slug")).status,
            level,
          ).to.equal(404);
        }
      } finally {
        InstanceManager.getPortalConfig.resolves({
          publicOffersEnabled: false,
        });
      }
    });
  });
});
