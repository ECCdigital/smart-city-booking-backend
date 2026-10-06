/**
 * Hero Layout storage, the Default Hero Layout and the Portal Name
 * (hero-layout ticket 06): `hero.title`/`hero.subtitle` are gone from the
 * Catalog, `heroLayout` is stored as a Mixed object defaulting to null, the
 * backend derives the Default Hero Layout of the Shared contract when
 * nothing is stored, the Theme Bundle carries `name`, `heroLayout` and
 * `logo`, the instance catalog PUT requires the Portal Name, and both
 * catalog PUTs refuse a `heroLayout` key on a tenant catalog. What the
 * instance catalog PUT makes of a `heroLayout` it is given is ticket 07's
 * `hero-layout-save.test.js`.
 *
 * No database: the media lookups run over a stubbed MediaManager, the
 * catalog reads and writes over stubbed managers, and the routes over the
 * lifecycle harness and the fixture world. The suites run in file order -
 * the harness installs its stubs last, and takes them down in its `after`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  DEFAULT_HERO_LAYOUT,
  LOGO_MEDIA_ID,
  PORTAL_NAME,
} = require("./fixtures/hero-layout/default-layout");
const { VARIANT_BACKGROUND } = require("./fixtures/hero-layout/backgrounds");
const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const {
  defaultHeroLayout,
} = require("../src/commons/services/hero-layout/hero-default-layout");
const {
  exportHeroLayout,
} = require("../src/commons/services/hero-layout/hero-export");
const {
  catalogSchemaDefinition,
} = require("../src/commons/schemas/catalogSchema");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const CatalogService = require("../src/commons/services/catalog-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const { Media } = require("../src/commons/entities/media/media");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");
const { ValidationError } = require("../src/errors/ValidationError");

const LOGO_URL = `/api/v2/instance/media/${LOGO_MEDIA_ID}/file`;

// The branding logo as `InstanceManager.getBranding` hands it out: the stored
// reference enriched with its URL.
const BRANDING_LOGO = Object.freeze({
  source: "media",
  mediaId: LOGO_MEDIA_ID,
  url: LOGO_URL,
});

/** The Blocks of the contract's default, by their id. */
const blockOf = (id) => DEFAULT_HERO_LAYOUT.blocks.find((b) => b.id === id);
const LOGO_BLOCK = blockOf("default-logo");
const TITLE_BLOCK = blockOf("default-title");
const SLOGAN_BLOCK = blockOf("default-subtitle");

/** A stored Hero Layout, as the instance catalog PUT writes one. */
const STORED_LAYOUT = Object.freeze({
  version: 1,
  height: "md",
  mobileHeight: "sm",
  compactHeight: "sm",
  blocks: [
    { ...TITLE_BLOCK, id: "own-title", text: { de: "Eigener Titel" } },
    { ...LOGO_BLOCK, id: "own-image" },
  ],
});

/** The logo medium, public instance image with dimensions. */
function logoMedium(overrides = {}) {
  return new Media({
    id: LOGO_MEDIA_ID,
    tenantId: null,
    kind: "image",
    visibility: "public",
    mimeType: "image/png",
    size: 1000,
    originalFileName: "logo.png",
    width: 640,
    height: 320,
    ...overrides,
  });
}

function stubLogoMedium(media = logoMedium()) {
  sinon
    .stub(MediaManager, "getMedia")
    .callsFake(async (mediaId, tenantId) =>
      mediaId === LOGO_MEDIA_ID && tenantId == null ? media : null,
    );
}

/** Runs a catalog write and hands back the details it refused with. */
async function refusalOf(write) {
  try {
    await write();
  } catch (error) {
    expect(error).to.be.instanceOf(ValidationError);
    return error.errors;
  }

  throw new Error("the write was accepted");
}

describe("the Catalog stores a Hero Layout, not a Hero", function () {
  it("has heroLayout as a Mixed field defaulting to null", function () {
    expect(catalogSchemaDefinition.heroLayout).to.deep.equal({
      type: Object,
      default: null,
    });
  });

  it("has no hero field any more", function () {
    expect(catalogSchemaDefinition).to.not.have.property("hero");
  });

  it("starts a catalog with heroLayout null and without hero", function () {
    const catalog = new Catalog({ name: "Portal" });

    expect(catalog.heroLayout).to.equal(null);
    expect(catalog).to.not.have.property("hero");
  });

  it("leaves heroLayout out of the public export of the catalog bundle", function () {
    const catalog = new Catalog({ name: "Portal", heroLayout: STORED_LAYOUT });

    expect(catalog.exportPublic()).to.not.have.property("heroLayout");
  });
});

describe("the derived Default Hero Layout", function () {
  it("is the contract's layout with a logo and a Portal Name", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(layout).to.deep.equal(DEFAULT_HERO_LAYOUT);
  });

  it("carries no Panel on any of its three Blocks", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(layout.blocks.map((block) => block.panel)).to.deep.equal([
      null,
      null,
      null,
    ]);
  });

  it("places all three Blocks at the alignment, offset and layer of a Hero that was never edited", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(
      layout.blocks.map(({ align, offset, layer }) => ({
        align,
        offset,
        layer,
      })),
    ).to.deep.equal(
      Array.from({ length: 3 }, () => ({
        align: "auto",
        offset: { x: 0, y: 0 },
        layer: "back",
      })),
    );
  });

  it("stacks the logo Block first, then the title, then the slogan", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(layout.blocks.map((b) => b.id)).to.deep.equal([
      "default-logo",
      "default-title",
      "default-subtitle",
    ]);
  });

  it("carries the stored form of the logo reference, not the enriched one", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(layout.blocks[0].image).to.deep.equal({
      source: "media",
      mediaId: LOGO_MEDIA_ID,
    });
  });

  it("omits the logo Block without a branding logo", function () {
    expect(defaultHeroLayout({ name: PORTAL_NAME, logo: null })).to.deep.equal({
      ...DEFAULT_HERO_LAYOUT,
      blocks: [TITLE_BLOCK, SLOGAN_BLOCK],
    });
    expect(
      defaultHeroLayout({ name: PORTAL_NAME, logo: undefined }).blocks,
    ).to.deep.equal([TITLE_BLOCK, SLOGAN_BLOCK]);
  });

  it("omits the logo Block for a legacy logo that is no medium", function () {
    const layout = defaultHeroLayout({
      name: PORTAL_NAME,
      logo: { source: "external", mediaId: null, url: "/logo.png" },
    });

    expect(layout.blocks).to.deep.equal([TITLE_BLOCK, SLOGAN_BLOCK]);
  });

  it("omits the title Block with an empty Portal Name, and invents none", function () {
    const layout = defaultHeroLayout({ name: "", logo: BRANDING_LOGO });

    expect(layout.blocks.map((b) => b.id)).to.deep.equal([
      "default-logo",
      "default-subtitle",
    ]);
    expect(layout.blocks[0].alt).to.deep.equal({ de: "" });
  });

  it("reads a missing or blank Portal Name as empty", function () {
    for (const name of [undefined, null, "   "]) {
      const layout = defaultHeroLayout({ name, logo: null });

      expect(layout.blocks).to.deep.equal([SLOGAN_BLOCK]);
    }
  });

  it("always carries the slogan Block in both languages", function () {
    const layout = defaultHeroLayout({ name: "", logo: null });

    expect(layout.blocks).to.deep.equal([SLOGAN_BLOCK]);
    expect(layout.blocks[0].text).to.deep.equal({
      de: "Entdecken Sie unsere Angebote",
      en: "Discover our offers",
    });
  });

  it("hands out a fresh object every time", function () {
    const one = defaultHeroLayout({ name: PORTAL_NAME, logo: BRANDING_LOGO });
    const two = defaultHeroLayout({ name: PORTAL_NAME, logo: BRANDING_LOGO });

    one.blocks[0].alt.de = "changed";

    expect(two.blocks[0].alt.de).to.equal(PORTAL_NAME);
  });
});

describe("the exported Hero Layout", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("derives the default when nothing is stored and enriches its logo", async function () {
    stubLogoMedium();

    const exported = await exportHeroLayout(null, {
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(exported).to.deep.equal({
      ...DEFAULT_HERO_LAYOUT,
      blocks: [
        {
          ...LOGO_BLOCK,
          image: {
            source: "media",
            mediaId: LOGO_MEDIA_ID,
            url: LOGO_URL,
            width: 640,
            height: 320,
          },
        },
        TITLE_BLOCK,
        SLOGAN_BLOCK,
      ],
    });
  });

  it("answers null dimensions while the logo is not backfilled", async function () {
    stubLogoMedium(logoMedium({ width: null, height: null }));

    const exported = await exportHeroLayout(null, {
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(exported.blocks[0].image.width).to.equal(null);
    expect(exported.blocks[0].image.height).to.equal(null);
  });

  it("keeps the logo Block of a missing medium instead of dropping it", async function () {
    sinon.stub(MediaManager, "getMedia").resolves(null);

    const exported = await exportHeroLayout(null, {
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(exported.blocks[0].image).to.deep.equal({
      source: "media",
      mediaId: LOGO_MEDIA_ID,
      url: LOGO_URL,
      width: null,
      height: null,
    });
  });

  it("delivers a stored layout as it is, image references enriched", async function () {
    stubLogoMedium();

    const exported = await exportHeroLayout(STORED_LAYOUT, {
      name: PORTAL_NAME,
      logo: BRANDING_LOGO,
    });

    expect(exported).to.deep.equal({
      ...STORED_LAYOUT,
      blocks: [
        STORED_LAYOUT.blocks[0],
        {
          ...STORED_LAYOUT.blocks[1],
          image: {
            source: "media",
            mediaId: LOGO_MEDIA_ID,
            url: LOGO_URL,
            width: 640,
            height: 320,
          },
        },
      ],
    });
  });

  it("leaves the stored layout untouched", async function () {
    stubLogoMedium();
    const stored = JSON.parse(JSON.stringify(STORED_LAYOUT));

    await exportHeroLayout(stored, { name: PORTAL_NAME, logo: BRANDING_LOGO });

    expect(stored).to.deep.equal(STORED_LAYOUT);
  });
});

describe("the Theme Bundle carries name, heroLayout, logo and background", function () {
  afterEach(function () {
    sinon.restore();
  });

  const activeBranding = (overrides = {}) => ({
    active: true,
    theme: { colors: { primary: "#123456", secondary: "#654321" } },
    logo: BRANDING_LOGO,
    favicon: null,
    logoUrl: `http://localhost${LOGO_URL}`,
    faviconUrl: "",
    ...overrides,
  });

  function stubBundle(catalog, branding) {
    sinon.stub(CatalogManager, "getInstanceCatalog").resolves(catalog);
    sinon.stub(CatalogManager, "getCatalogBySlug").resolves(catalog);
    sinon.stub(InstanceManager, "getBranding").resolves(branding);
  }

  it("delivers the four keys next to the unchanged branding keys, and no hero", async function () {
    stubLogoMedium();
    stubBundle(
      new Catalog({ name: PORTAL_NAME, visibility: "unlisted" }),
      activeBranding(),
    );

    const bundle = await CatalogService.getTheme();

    expect(Object.keys(bundle).sort()).to.deep.equal(
      [
        "active",
        "logoUrl",
        "faviconUrl",
        "theme",
        "name",
        "heroLayout",
        "background",
        "logo",
        "visibility",
      ].sort(),
    );
    expect(bundle).to.not.have.property("hero");
    expect(bundle.active).to.equal(true);
    expect(bundle.logoUrl).to.equal(`http://localhost${LOGO_URL}`);
    expect(bundle.faviconUrl).to.equal("");
    expect(bundle.theme).to.deep.equal({
      colors: { primary: "#123456", secondary: "#654321" },
    });
    expect(bundle.visibility).to.equal("unlisted");
    expect(bundle.name).to.equal(PORTAL_NAME);
    expect(bundle.background).to.deep.equal(VARIANT_BACKGROUND);
  });

  it("derives the Default Hero Layout with the logo of the branding", async function () {
    stubLogoMedium();
    stubBundle(new Catalog({ name: PORTAL_NAME }), activeBranding());

    const bundle = await CatalogService.getTheme();

    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-logo",
      "default-title",
      "default-subtitle",
    ]);
    expect(bundle.heroLayout.blocks[0].image.url).to.equal(LOGO_URL);
    expect(bundle.heroLayout.blocks[1].text).to.deep.equal({
      de: PORTAL_NAME,
    });
  });

  it("enriches the logo with URL and dimensions", async function () {
    stubLogoMedium();
    stubBundle(new Catalog({ name: PORTAL_NAME }), activeBranding());

    const bundle = await CatalogService.getTheme();

    expect(bundle.logo).to.deep.equal({
      source: "media",
      mediaId: LOGO_MEDIA_ID,
      url: LOGO_URL,
      width: 640,
      height: 320,
    });
  });

  it("answers logo null and no logo Block without a branding logo", async function () {
    stubBundle(
      new Catalog({ name: PORTAL_NAME }),
      activeBranding({ logo: null, logoUrl: "" }),
    );

    const bundle = await CatalogService.getTheme();

    expect(bundle.logo).to.equal(null);
    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-title",
      "default-subtitle",
    ]);
  });

  it("follows branding.active for the logo, like logoUrl and the Background", async function () {
    stubBundle(
      new Catalog({ name: PORTAL_NAME }),
      activeBranding({ active: false }),
    );

    const bundle = await CatalogService.getTheme();

    expect(bundle.logoUrl).to.equal(null);
    expect(bundle.logo).to.equal(null);
    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-title",
      "default-subtitle",
    ]);
  });

  it("omits the title Block of a legacy catalog without a Portal Name", async function () {
    stubBundle(new Catalog({ name: "" }), activeBranding({ logo: null }));

    const bundle = await CatalogService.getTheme();

    expect(bundle.name).to.equal("");
    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-subtitle",
    ]);
  });

  it("delivers a stored layout in place of the default", async function () {
    stubLogoMedium();
    stubBundle(
      new Catalog({ name: PORTAL_NAME, heroLayout: STORED_LAYOUT }),
      activeBranding(),
    );

    const bundle = await CatalogService.getTheme();

    expect(bundle.heroLayout.height).to.equal("md");
    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "own-title",
      "own-image",
    ]);
    expect(bundle.heroLayout.blocks[1].image.url).to.equal(LOGO_URL);
  });

  it("carries the four keys on a slug bundle too", async function () {
    stubLogoMedium();
    stubBundle(
      new Catalog({
        type: "single",
        slug: "town-hall",
        name: "Town hall",
        tenantId: "t1",
      }),
      activeBranding(),
    );

    const bundle = await CatalogService.getThemeBySlug("town-hall");

    expect(bundle.name).to.equal("Town hall");
    expect(bundle.heroLayout.blocks[1].text).to.deep.equal({
      de: "Town hall",
    });
    expect(bundle.logo.mediaId).to.equal(LOGO_MEDIA_ID);
    expect(bundle.background).to.deep.equal(VARIANT_BACKGROUND);
    expect(bundle).to.not.have.property("hero");
  });

  it("answers an instance without a catalog with an empty name and the slogan", async function () {
    stubBundle(null, activeBranding({ logo: null }));

    const bundle = await CatalogService.getTheme();

    expect(bundle.name).to.equal("");
    expect(bundle.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-subtitle",
    ]);
    expect(bundle.visibility).to.equal("public");
  });

  it("keeps theme data out of the catalog bundle and the portal mode", async function () {
    stubBundle(
      new Catalog({ name: PORTAL_NAME, heroLayout: STORED_LAYOUT }),
      activeBranding(),
    );
    sinon.stub(InstanceManager, "getPortalConfig").resolves({
      publicOffersEnabled: true,
      portalUrl: "",
    });
    sinon.stub(TenantManager, "getTenants").resolves([]);

    const bundle = await CatalogService.getCatalogBundle();
    const mode = await CatalogService.getPortalMode();

    for (const body of [bundle, bundle.catalog, bundle.branding, mode]) {
      for (const key of ["hero", "heroLayout", "background", "logo"]) {
        expect(body).to.not.have.property(key);
      }
    }
  });
});

describe("the catalog writes: Portal Name and heroLayout", function () {
  beforeEach(function () {
    sinon.stub(CatalogManager, "getInstanceCatalog").resolves(null);
    sinon.stub(CatalogManager, "getCatalogByTenant").resolves(null);
    sinon.stub(CatalogManager, "createCatalog").resolves({ id: "c1" });
    sinon.stub(CatalogManager, "updateCatalog").resolves({ id: "c1" });
  });

  afterEach(function () {
    sinon.restore();
    ThemeExportCache.invalidateAll();
  });

  it("refuses an instance catalog update without a Portal Name", async function () {
    for (const body of [
      { _id: "c1" },
      { _id: "c1", name: "" },
      { _id: "c1", name: null },
      { _id: "c1", name: "   " },
    ]) {
      const details = await refusalOf(() =>
        CatalogService.updateInstanceCatalog(body),
      );

      expect(details).to.deep.equal([{ field: "name", code: "required" }]);
    }
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });

  it("refuses an instance catalog creation without a Portal Name", async function () {
    const details = await refusalOf(() =>
      CatalogService.createInstanceCatalog({ name: "" }),
    );

    expect(details).to.deep.equal([{ field: "name", code: "required" }]);
    expect(CatalogManager.createCatalog.called).to.equal(false);
  });

  it("writes an instance catalog that carries its Portal Name", async function () {
    await CatalogService.updateInstanceCatalog({ _id: "c1", name: "Portal" });

    expect(CatalogManager.updateCatalog.calledOnce).to.equal(true);
  });

  it("refuses a heroLayout key on every tenant catalog write", async function () {
    const writes = {
      createTenantCatalog: (body) =>
        CatalogService.createTenantCatalog("t1", body),
      updateTenantCatalog: (body) =>
        CatalogService.updateTenantCatalog("t1", body),
      updateCatalog: (body) =>
        CatalogService.updateCatalog({ tenantId: "t1", ...body }),
    };

    for (const [name, write] of Object.entries(writes)) {
      const details = await refusalOf(() =>
        write({ _id: "c1", name: "Katalog", heroLayout: null }),
      );

      expect(details, name).to.deep.equal([
        { field: "heroLayout", code: "unknown_field" },
      ]);
    }
    expect(CatalogManager.createCatalog.called).to.equal(false);
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });

  it("does not demand a Portal Name of a tenant catalog", async function () {
    await CatalogService.updateTenantCatalog("t1", { _id: "c1" });

    expect(CatalogManager.updateCatalog.calledOnce).to.equal(true);
  });
});

describe("catalog routes: heroLayout as stored, Portal Name and the ETag", function () {
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
    CatalogManager.getInstanceCatalog.callsFake(async () => fixtureCatalog);
    CatalogManager.getCatalogByTenant.callsFake(async () => fixtureCatalog);
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

  const catalogWith = (overrides) =>
    new Catalog({ ...fixtureCatalog, ...overrides });

  it("returns heroLayout exactly as stored on GET /api/catalog", async function () {
    CatalogManager.getInstanceCatalog.callsFake(async () =>
      catalogWith({ heroLayout: STORED_LAYOUT }),
    );

    const res = await get("/catalog", ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body.heroLayout).to.deep.equal(STORED_LAYOUT);
    expect(res.body).to.not.have.property("hero");
  });

  it("returns heroLayout null, not a derived layout, when nothing is stored", async function () {
    const res = await get("/catalog", ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body.heroLayout).to.equal(null);
  });

  it("answers an instance catalog PUT without a Portal Name with 400 required", async function () {
    const res = await put("/catalog", ADMIN, { _id: FIXTURE_ID, name: "" });

    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({
      error: "ValidationError",
      message: "validation_failed",
      statusCode: 400,
      details: [{ field: "name", code: "required" }],
    });
  });

  it("answers a heroLayout key on the tenant catalog PUT with 400 unknown_field", async function () {
    const res = await put(`/${TENANT}/catalog`, OWNER, {
      _id: FIXTURE_ID,
      type: "single",
      tenantId: TENANT,
      slug: "fx-slug",
      name: "Katalog",
      heroLayout: STORED_LAYOUT,
    });

    expect(res.status).to.equal(400);
    expect(res.body.details).to.deep.equal([
      { field: "heroLayout", code: "unknown_field" },
    ]);
  });

  it("delivers the Theme Bundle with name, heroLayout, logo and background", async function () {
    const res = await get("/catalog/themes", ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body.name).to.equal("Katalog");
    expect(res.body.logo).to.equal(null);
    expect(res.body.background).to.deep.equal(VARIANT_BACKGROUND);
    expect(res.body.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
      "default-title",
      "default-subtitle",
    ]);
    expect(res.body).to.not.have.property("hero");
  });

  it("changes the ETag when the Portal Name is edited", async function () {
    const before = await get("/catalog/themes", ADMIN);
    expect(before.body.name).to.equal("Katalog");

    CatalogManager.getInstanceCatalog.callsFake(async () =>
      catalogWith({ name: "Neuer Name" }),
    );
    const write = await put("/catalog", ADMIN, {
      _id: FIXTURE_ID,
      name: "Neuer Name",
    });
    expect(write.status).to.equal(200);

    const after = await get("/catalog/themes", ADMIN);
    expect(after.body.name).to.equal("Neuer Name");
    expect(after.body.heroLayout.blocks[0].text).to.deep.equal({
      de: "Neuer Name",
    });
    expect(after.headers.etag).to.not.equal(before.headers.etag);
  });
});
