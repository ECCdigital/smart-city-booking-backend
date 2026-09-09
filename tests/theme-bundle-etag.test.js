/**
 * The Theme Bundle revalidates with an ETag (hero-layout ticket 04): both
 * `GET /api/catalog/themes` and `GET /api/catalog/themes/:slug` are served
 * from the theme export cache, carry a strong tag and `Cache-Control:
 * no-cache`, and answer a matching `If-None-Match` with 304. There is no
 * purge: every write that can change an export invalidates the cache whole.
 *
 * No database: the cache is exercised directly, the instance write over a
 * stubbed model, and the routes over the lifecycle harness and the fixture
 * world. The suites run in file order - the harness installs its stubs
 * last, and takes them down in its `after`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const CatalogService = require("../src/commons/services/catalog-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

describe("theme export cache", function () {
  beforeEach(function () {
    ThemeExportCache.invalidateAll();
  });

  after(function () {
    ThemeExportCache.invalidateAll();
  });

  it("builds a key once and answers the stored body and tag after that", async function () {
    const build = sinon.fake.resolves({ name: "Portal" });

    const first = await ThemeExportCache.remember("theme:instance", build);
    const second = await ThemeExportCache.remember("theme:instance", build);

    expect(build.callCount).to.equal(1);
    expect(second.body).to.deep.equal(first.body);
    expect(second.etag).to.equal(first.etag);
  });

  it("tags one body the same way twice and two bodies differently", async function () {
    const one = await ThemeExportCache.remember("a", async () => ({ v: 1 }));
    ThemeExportCache.invalidateAll();
    const again = await ThemeExportCache.remember("a", async () => ({ v: 1 }));
    const other = await ThemeExportCache.remember("b", async () => ({ v: 2 }));

    expect(again.etag).to.equal(one.etag);
    expect(other.etag).to.not.equal(one.etag);
  });

  it("writes a strong quoted tag", async function () {
    const { etag } = await ThemeExportCache.remember("a", async () => ({}));

    expect(etag).to.match(/^"[0-9a-f]{16}"$/);
  });

  it("holds one entry per instance bundle and one per slug", function () {
    expect(ThemeExportCache.keyFor()).to.equal("theme:instance");
    expect(ThemeExportCache.keyFor(null)).to.equal("theme:instance");
    expect(ThemeExportCache.keyFor("town-hall")).to.equal(
      "theme:slug:town-hall",
    );
  });

  it("stores nothing when the build throws", async function () {
    let refused;
    try {
      await ThemeExportCache.remember("a", async () => {
        throw new Error("boom");
      });
    } catch (error) {
      refused = error;
    }
    expect(refused?.message).to.equal("boom");

    const build = sinon.fake.resolves({ v: 1 });
    await ThemeExportCache.remember("a", build);

    expect(build.callCount).to.equal(1);
  });

  it("stores nothing that was built before an invalidation in flight", async function () {
    const raced = await ThemeExportCache.remember("a", async () => {
      ThemeExportCache.invalidateAll();
      return { v: 1 };
    });
    expect(raced.body).to.deep.equal({ v: 1 });

    const rebuild = sinon.fake.resolves({ v: 2 });
    await ThemeExportCache.remember("a", rebuild);

    expect(rebuild.callCount).to.equal(1);
  });

  it("drops every key at once, not the one that changed", async function () {
    await ThemeExportCache.remember("a", async () => ({ v: 1 }));
    await ThemeExportCache.remember("b", async () => ({ v: 2 }));

    ThemeExportCache.invalidateAll();

    const a = sinon.fake.resolves({ v: 1 });
    const b = sinon.fake.resolves({ v: 2 });
    await ThemeExportCache.remember("a", a);
    await ThemeExportCache.remember("b", b);

    expect(a.callCount).to.equal(1);
    expect(b.callCount).to.equal(1);
  });
});

describe("an instance write invalidates the theme export cache", function () {
  afterEach(function () {
    sinon.restore();
    ThemeExportCache.invalidateAll();
  });

  it("drops the bundle the branding of that instance was exported into", async function () {
    const raw = {
      bookableCustomFields: [],
      toEntity: () => ({ bookableCustomFields: [] }),
    };
    sinon.stub(InstanceModel, "findOne").resolves(raw);
    sinon.stub(InstanceModel, "findOneAndUpdate").resolves(raw);

    const before = await ThemeExportCache.remember(
      ThemeExportCache.keyFor(),
      async () => ({ logoUrl: "/old.png" }),
    );
    await InstanceManager.updateInstance({ bookableCustomFields: [] });
    const after = await ThemeExportCache.remember(
      ThemeExportCache.keyFor(),
      async () => ({ logoUrl: "/new.png" }),
    );

    expect(after.body).to.deep.equal({ logoUrl: "/new.png" });
    expect(after.etag).to.not.equal(before.etag);
  });
});

describe("every catalog write invalidates the theme export cache", function () {
  /**
   * The invalidation is one statement at each write of the service, and the
   * cache has no TTL - a write path added later that forgets it would serve
   * a stale bundle for good. This suite is the guard: the first case fails
   * when a write is added, the rest pin what each of them does.
   */
  const WRITES = {
    createInstanceCatalog: () => CatalogService.createInstanceCatalog({}),
    createTenantCatalog: () => CatalogService.createTenantCatalog("t1", {}),
    updateCatalog: () => CatalogService.updateCatalog({ tenantId: "t1" }),
    updateInstanceCatalog: () => CatalogService.updateInstanceCatalog({}),
    updateTenantCatalog: () => CatalogService.updateTenantCatalog("t1", {}),
  };

  beforeEach(function () {
    // Nothing stored yet, so the two creates get past their conflict check.
    sinon.stub(CatalogManager, "getInstanceCatalog").resolves(null);
    sinon.stub(CatalogManager, "getCatalogByTenant").resolves(null);
    sinon.stub(CatalogManager, "createCatalog").resolves({ id: "c1" });
    sinon.stub(CatalogManager, "updateCatalog").resolves({ id: "c1" });
  });

  afterEach(function () {
    sinon.restore();
    ThemeExportCache.invalidateAll();
  });

  it("names every write the service has", function () {
    const writes = Object.getOwnPropertyNames(CatalogService).filter((name) =>
      /^(create|update)/.test(name),
    );

    expect(writes.sort()).to.deep.equal(Object.keys(WRITES).sort());
  });

  for (const [name, write] of Object.entries(WRITES)) {
    it(`invalidates on ${name}`, async function () {
      const before = await ThemeExportCache.remember(
        ThemeExportCache.keyFor(),
        async () => ({ v: 1 }),
      );

      await write();

      const after = await ThemeExportCache.remember(
        ThemeExportCache.keyFor(),
        async () => ({ v: 2 }),
      );
      expect(after.body).to.deep.equal({ v: 2 });
      expect(after.etag).to.not.equal(before.etag);
    });
  }
});

describe("Theme Bundle routes: ETag, 304 and the invalidation", function () {
  this.timeout(20000);

  let h;
  let fixtureCatalog;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: OWNER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    fixtureCatalog = await CatalogManager.getInstanceCatalog();
  });

  beforeEach(function () {
    ThemeExportCache.invalidateAll();
  });

  afterEach(function () {
    // Back to the fixture world, and to an empty cache, for the next case.
    CatalogManager.getInstanceCatalog.callsFake(async () => fixtureCatalog);
    CatalogManager.getCatalogBySlug.callsFake(async () => fixtureCatalog);
    InstanceManager.getBranding.callsFake(async () => ({ active: false }));
    ThemeExportCache.invalidateAll();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const get = (path, userId) => h.api().get(`/api${path}`).set(h.as(userId));
  const put = (path, userId, body) =>
    h.api().put(`/api${path}`).set(h.as(userId)).send(body);

  /** The fixture catalog with a field changed, so the export changes. */
  const catalogWith = (overrides) =>
    new Catalog({ ...fixtureCatalog, ...overrides });

  /** A slug catalog the slug route may read: active, of the fixture tenant. */
  const activeSlugCatalog = () => catalogWith({ active: true });

  const brandedBranding = () => ({
    active: true,
    logoUrl: "/media/logo.png",
    faviconUrl: "/media/favicon.ico",
    theme: { colors: { primary: "#123456", secondary: "#654321" } },
  });

  it("carries a strong ETag and Cache-Control: no-cache on both routes", async function () {
    CatalogManager.getCatalogBySlug.callsFake(async () => activeSlugCatalog());

    const instance = await get("/catalog/themes", ADMIN);
    const bySlug = await get("/catalog/themes/fx-slug", ADMIN);

    for (const res of [instance, bySlug]) {
      expect(res.status).to.equal(200);
      expect(res.headers.etag).to.match(/^"[0-9a-f]{16}"$/);
      expect(res.headers["cache-control"]).to.equal("no-cache");
    }
  });

  it("keeps the tag stable across repeated reads without a write", async function () {
    const first = await get("/catalog/themes", ADMIN);
    const second = await get("/catalog/themes", ADMIN);
    const third = await get("/catalog/themes", ADMIN);

    expect(second.headers.etag).to.equal(first.headers.etag);
    expect(third.headers.etag).to.equal(first.headers.etag);
    expect(second.body).to.deep.equal(first.body);
  });

  it("answers a matching If-None-Match with 304 and no body", async function () {
    const first = await get("/catalog/themes", ADMIN);

    const second = await get("/catalog/themes", ADMIN).set(
      "If-None-Match",
      first.headers.etag,
    );

    expect(second.status).to.equal(304);
    expect(second.text).to.satisfy((text) => !text);
    expect(second.headers.etag).to.equal(first.headers.etag);
    expect(second.headers["cache-control"]).to.equal("no-cache");
  });

  it("answers a matching If-None-Match on the slug route with 304", async function () {
    CatalogManager.getCatalogBySlug.callsFake(async () => activeSlugCatalog());

    const first = await get("/catalog/themes/fx-slug", ADMIN);
    const second = await get("/catalog/themes/fx-slug", ADMIN).set(
      "If-None-Match",
      first.headers.etag,
    );

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(304);
  });

  it("answers a stale tag with 200, the fresh body and the fresh tag", async function () {
    const stale = await get("/catalog/themes", ADMIN);

    CatalogManager.getInstanceCatalog.callsFake(async () =>
      catalogWith({ visibility: "private" }),
    );
    await put("/catalog", ADMIN, { _id: FIXTURE_ID, name: "Katalog" });

    const fresh = await get("/catalog/themes", ADMIN).set(
      "If-None-Match",
      stale.headers.etag,
    );

    expect(fresh.status).to.equal(200);
    expect(fresh.body.visibility).to.equal("private");
    expect(fresh.headers.etag).to.not.equal(stale.headers.etag);
  });

  it("invalidates on an instance catalog update, so the tag follows the visibility", async function () {
    const before = await get("/catalog/themes", ADMIN);
    expect(before.body.visibility).to.equal("public");

    CatalogManager.getInstanceCatalog.callsFake(async () =>
      catalogWith({ visibility: "unlisted" }),
    );
    const write = await put("/catalog", ADMIN, {
      _id: FIXTURE_ID,
      name: "Katalog",
    });
    expect(write.status).to.equal(200);

    const after = await get("/catalog/themes", ADMIN);
    expect(after.body.visibility).to.equal("unlisted");
    expect(after.headers.etag).to.not.equal(before.headers.etag);
  });

  it("tags a branded instance differently from a plain one", async function () {
    const plain = await get("/catalog/themes", ADMIN);
    expect(plain.body.logoUrl).to.equal(null);

    ThemeExportCache.invalidateAll();
    InstanceManager.getBranding.callsFake(async () => brandedBranding());
    const branded = await get("/catalog/themes", ADMIN);

    expect(branded.body.logoUrl).to.equal("/media/logo.png");
    expect(branded.headers.etag).to.not.equal(plain.headers.etag);
  });

  it("invalidates on a tenant catalog update, so the tag follows the branding", async function () {
    const before = await get("/catalog/themes", ADMIN);
    expect(before.body.logoUrl).to.equal(null);

    InstanceManager.getBranding.callsFake(async () => brandedBranding());
    const write = await put(`/${TENANT}/catalog`, OWNER, {
      _id: FIXTURE_ID,
      type: "single",
      tenantId: TENANT,
      slug: "fx-slug",
      name: "Katalog",
    });
    expect(write.status).to.equal(200);

    const after = await get("/catalog/themes", ADMIN);
    expect(after.body.logoUrl).to.equal("/media/logo.png");
    expect(after.headers.etag).to.not.equal(before.headers.etag);
  });

  it("keeps the cache across a media update", async function () {
    const before = await get("/catalog/themes", ADMIN);

    // A rebuild would pick this up; the answer below proves there was none.
    InstanceManager.getBranding.callsFake(async () => brandedBranding());
    const write = await h
      .api()
      .patch(`/api/v2/instance/media/${FIXTURE_ID}`)
      .set(h.as(ADMIN))
      .send({ title: "New title" });
    expect(write.status).to.equal(200);

    const after = await get("/catalog/themes", ADMIN);
    expect(after.headers.etag).to.equal(before.headers.etag);
    expect(after.body.logoUrl).to.equal(null);
  });
});
