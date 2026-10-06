/**
 * The Hero editor endpoints (hero-layout ticket 08): the three routes the
 * Hero Editor of the admin UI talks to. `GET /api/catalog/hero-layout` reads
 * the layout, the Background and the Portal Name in export form and says
 * whether they are derived; `PUT` validates both objects, writes the catalog
 * and then the instance and flushes the theme export cache once; `POST
 * /hero-layout/preview` runs the same normaliser and enrichment and writes
 * nothing.
 *
 * No database: the catalog and instance writes run over stubbed managers, the
 * media lookups over a stubbed MediaManager, and the routes over the
 * lifecycle harness and the fixture world.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  DEFAULT_HERO_LAYOUT,
  LOGO_MEDIA_ID,
  PORTAL_NAME,
} = require("./fixtures/hero-layout/default-layout");
const {
  ACCEPTANCE_LAYOUT,
  CREST_MEDIA_ID,
} = require("./fixtures/hero-layout/acceptance-layout");
const {
  COLOR_BACKGROUND,
  IMAGE_BACKGROUND,
  IMAGE_MEDIA_ID,
  VARIANT_BACKGROUND,
} = require("./fixtures/hero-layout/backgrounds");
const {
  FILLED_BLOCK_DEFAULTS,
  GLAS_PANEL,
  LAYOUT_MEDIA_ID,
  MINIMAL_LAYOUT,
  MINIMAL_LAYOUT_STORED,
  MINIMAL_TEXT_BLOCK,
  layoutOf,
} = require("./fixtures/hero-layout/layouts");
const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const MediaManager = require("../src/commons/data-managers/media-manager");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const { Media } = require("../src/commons/entities/media/media");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

/** The Portal Name of the fixture catalog. */
const CATALOG_NAME = "Katalog";

/** A stored instance medium, public image by default. */
function instanceImage(id, overrides = {}) {
  return new Media({
    id,
    tenantId: null,
    kind: "image",
    visibility: "public",
    mimeType: "image/png",
    size: 1000,
    originalFileName: "bild.png",
    width: 1200,
    height: 800,
    ...overrides,
  });
}

/** The export form of a media reference: the pair plus its derived keys. */
const enriched = (mediaId) => ({
  source: "media",
  mediaId,
  url: `/api/v2/instance/media/${mediaId}/file`,
  width: 1200,
  height: 800,
});

/** The branding logo as `getBranding` hands it out. */
const BRANDING_LOGO = Object.freeze({
  source: "media",
  mediaId: LOGO_MEDIA_ID,
  url: `/api/v2/instance/media/${LOGO_MEDIA_ID}/file`,
});

describe("the Background write of a Hero save", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("sets the Background inside the branding and touches nothing else", async function () {
    const updateOne = sinon
      .stub(InstanceModel, "updateOne")
      .resolves({ matchedCount: 1 });
    const invalidate = sinon.stub(InstanceCache, "invalidate");

    await InstanceManager.updateBackground(COLOR_BACKGROUND);

    expect(updateOne.firstCall.args).to.deep.equal([
      {},
      { $set: { "branding.background": COLOR_BACKGROUND } },
    ]);
    expect(invalidate.calledOnce).to.equal(true);
  });

  it("stores null as the reset to the default Background", async function () {
    const updateOne = sinon
      .stub(InstanceModel, "updateOne")
      .resolves({ matchedCount: 1 });
    sinon.stub(InstanceCache, "invalidate");

    await InstanceManager.updateBackground(null);

    expect(updateOne.firstCall.args[1]).to.deep.equal({
      $set: { "branding.background": null },
    });
  });

  it("says so when there is no instance to write, rather than passing", async function () {
    sinon.stub(InstanceModel, "updateOne").resolves({ matchedCount: 0 });
    const invalidate = sinon.stub(InstanceCache, "invalidate");

    let refusal;
    try {
      await InstanceManager.updateBackground(COLOR_BACKGROUND);
    } catch (error) {
      refusal = error;
    }

    expect(refusal?.code).to.equal("instance_not_found");
    expect(invalidate.called).to.equal(false);
  });
});

describe("the Hero editor endpoints", function () {
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
    sinon.spy(ThemeExportCache, "invalidateAll");
  });

  beforeEach(function () {
    CatalogManager.updateCatalog.resetHistory();
    // The manager answers the catalog as it stands after the write.
    CatalogManager.updateCatalog.callsFake(
      async (data) => new Catalog({ ...fixtureCatalog, ...data }),
    );
    InstanceManager.updateBackground.resetHistory();
    // Behaviour, not just history: a case that makes the Background write
    // fail would otherwise leave the rejection standing for the rest of the
    // suite, the way `updateCatalog` above is re-armed every time.
    InstanceManager.updateBackground.resolves();
    ThemeExportCache.invalidateAll.resetHistory();
    MediaManager.getMedia.callsFake(async (mediaId, tenantId) =>
      tenantId == null ? instanceImage(mediaId) : null,
    );
  });

  afterEach(function () {
    CatalogManager.getInstanceCatalog.callsFake(async () => fixtureCatalog);
    InstanceManager.getBranding.callsFake(async () => ({ active: false }));
    ThemeExportCache.invalidateAll();
  });

  after(async function () {
    ThemeExportCache.invalidateAll.restore();
    sinon.restore();
    await h.close();
  });

  const get = (path, userId) =>
    userId
      ? h.api().get(`/api${path}`).set(h.as(userId))
      : h.api().get(`/api${path}`);
  const put = (path, userId, body) =>
    userId
      ? h.api().put(`/api${path}`).set(h.as(userId)).send(body)
      : h.api().put(`/api${path}`).send(body);
  const post = (path, userId, body) =>
    userId
      ? h.api().post(`/api${path}`).set(h.as(userId)).send(body)
      : h.api().post(`/api${path}`).send(body);

  const readEditor = () => get("/catalog/hero-layout", ADMIN);
  const save = (body) => put("/catalog/hero-layout", ADMIN, body);
  const preview = (body) => post("/catalog/hero-layout/preview", ADMIN, body);

  /** Puts a stored layout and a stored Background behind the routes. */
  function stored({
    heroLayout = null,
    background = null,
    logo = null,
    active = true,
  } = {}) {
    CatalogManager.getInstanceCatalog.callsFake(
      async () => new Catalog({ ...fixtureCatalog, heroLayout }),
    );
    InstanceManager.getBranding.callsFake(async () => ({
      active,
      logo,
      background,
    }));
  }

  /** What the write handed the catalog manager. */
  const writtenLayout = () =>
    CatalogManager.updateCatalog.firstCall.args[0].heroLayout;

  /** What the write handed the instance manager. */
  const writtenBackground = () =>
    InstanceManager.updateBackground.firstCall.args[0];

  /**
   * A layout as it was stored before the Panel became an object: complete
   * otherwise, the two legacy words where a Panel stands today.
   */
  const legacyPanelLayout = () => ({
    ...MINIMAL_LAYOUT_STORED,
    blocks: MINIMAL_LAYOUT_STORED.blocks.map((block, index) => ({
      ...block,
      panel: index === 1 ? "translucent" : "none",
    })),
  });

  /**
   * A layout as it was stored before the amendment: the legacy Panel words,
   * and none of the fields the amendment added — no `align`, no `offset`, no
   * `layer`, and no `size` on the rich-text Block.
   */
  const preAmendmentLayout = () => ({
    ...legacyPanelLayout(),
    blocks: legacyPanelLayout().blocks.map((block) => {
      const added = ["align", "offset", "layer"];

      if (block.type === "richtext") {
        added.push("size");
      }

      return Object.fromEntries(
        Object.entries(block).filter(([key]) => !added.includes(key)),
      );
    }),
  });

  /** What a pre-amendment layout is delivered as: the same layout, complete. */
  const PRE_AMENDMENT_EXPORTED = Object.freeze({
    ...MINIMAL_LAYOUT_STORED,
    blocks: MINIMAL_LAYOUT_STORED.blocks.map((block, index) => ({
      ...block,
      panel: index === 1 ? GLAS_PANEL : null,
      ...(block.type === "image" ? { image: enriched(LAYOUT_MEDIA_ID) } : {}),
    })),
  });

  /**
   * A Block placed away from where its Zone alone would put it: centred in
   * its own box, half a rem down, and painting in front of what it overlaps.
   */
  const PLACED_BLOCK = Object.freeze({
    ...MINIMAL_TEXT_BLOCK,
    align: "center",
    offset: { x: -1.5, y: 0.5 },
    layer: "front",
  });

  /** The placement of the Blocks a layout carries. */
  const placementOf = (layout) =>
    layout.blocks.map(({ align, offset, layer }) => ({ align, offset, layer }));

  /** The Panels of the layout an answer carries. */
  const panelsOf = (body) => body.heroLayout.blocks.map((block) => block.panel);

  /** The `field`/`code` pairs of a refusal. */
  const codesOf = (body) =>
    body.details.map(({ field, code }) => ({ field, code }));

  describe("GET /api/catalog/hero-layout", function () {
    it("answers the derived defaults with isDefault true on a fresh instance", async function () {
      stored({ heroLayout: null, background: null });

      const res = await readEditor();

      expect(res.status).to.equal(200);
      expect(res.body.isDefault).to.equal(true);
      expect(res.body.name).to.equal(CATALOG_NAME);
      expect(res.body.background).to.deep.equal(VARIANT_BACKGROUND);
      expect(res.body.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
        "default-title",
        "default-subtitle",
      ]);
    });

    it("derives the Default Hero Layout with the branding logo, enriched", async function () {
      stored({ logo: BRANDING_LOGO });

      const res = await readEditor();

      expect(res.body.heroLayout.blocks[0].id).to.equal("default-logo");
      expect(res.body.heroLayout.blocks[0].image).to.deep.equal(
        enriched(LOGO_MEDIA_ID),
      );
    });

    it("leaves the logo Block out while the branding is off, as the bundle does", async function () {
      stored({ logo: BRANDING_LOGO, active: false });

      const res = await readEditor();

      expect(res.body.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
        "default-title",
        "default-subtitle",
      ]);
    });

    it("answers the stored objects with isDefault false after a save", async function () {
      stored({
        heroLayout: MINIMAL_LAYOUT_STORED,
        background: COLOR_BACKGROUND,
      });

      const res = await readEditor();

      expect(res.status).to.equal(200);
      expect(res.body.isDefault).to.equal(false);
      expect(res.body.background).to.deep.equal(COLOR_BACKGROUND);
      expect(res.body.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
        "t1",
        "r1",
        "i1",
      ]);
    });

    it("delivers the placement of a stored Block as it stands", async function () {
      stored({ heroLayout: layoutOf(PLACED_BLOCK) });

      const res = await readEditor();

      expect(res.status).to.equal(200);
      expect(placementOf(res.body.heroLayout)).to.deep.equal([
        { align: "center", offset: { x: -1.5, y: 0.5 }, layer: "front" },
      ]);
    });

    it("normalises a stored legacy Panel on the way out", async function () {
      // Written before the Panel became an object and never migrated: the
      // editor is answered the objects the contract names, never a word.
      stored({ heroLayout: legacyPanelLayout() });

      const res = await readEditor();

      expect(res.status).to.equal(200);
      expect(panelsOf(res.body)).to.deep.equal([null, GLAS_PANEL, null]);
    });

    it("fills the fields the amendment added into a layout stored before it", async function () {
      // Stored before the amendment and never migrated: the editor is handed
      // the layout in the shape the contract names today, defaults and all.
      stored({ heroLayout: preAmendmentLayout() });

      const res = await readEditor();

      expect(res.status).to.equal(200);
      expect(res.body.heroLayout).to.deep.equal(PRE_AMENDMENT_EXPORTED);
    });

    it("enriches the media references of the layout and the Background", async function () {
      stored({
        heroLayout: MINIMAL_LAYOUT_STORED,
        background: IMAGE_BACKGROUND,
      });

      const res = await readEditor();

      expect(res.body.heroLayout.blocks[2].image).to.deep.equal(
        enriched(LAYOUT_MEDIA_ID),
      );
      expect(res.body.background.image).to.deep.equal(enriched(IMAGE_MEDIA_ID));
    });

    it("says isDefault true while only the Background is stored", async function () {
      stored({ heroLayout: null, background: COLOR_BACKGROUND });

      const res = await readEditor();

      expect(res.body.isDefault).to.equal(true);
    });

    it("says isDefault false for a stored layout whatever the Background is", async function () {
      stored({ heroLayout: MINIMAL_LAYOUT_STORED, background: null });
      const derived = await readEditor();

      stored({
        heroLayout: MINIMAL_LAYOUT_STORED,
        background: COLOR_BACKGROUND,
      });
      const withBackground = await readEditor();

      expect(derived.body.isDefault).to.equal(false);
      // The answered Background is the derived default here, and the flag is
      // still false: it follows the stored layout, nothing of the Background.
      expect(derived.body.background).to.deep.equal(VARIANT_BACKGROUND);
      expect(withBackground.body.isDefault).to.equal(false);
    });

    it("answers a missing instance catalog with 404", async function () {
      CatalogManager.getInstanceCatalog.resolves(null);

      const res = await readEditor();

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("instance_catalog_not_found");
    });

    it("carries no envelope: the export object is the body", async function () {
      stored();

      const res = await readEditor();

      expect(Object.keys(res.body).sort()).to.deep.equal([
        "background",
        "heroLayout",
        "isDefault",
        "name",
      ]);
    });
  });

  describe("PUT /api/catalog/hero-layout", function () {
    it("stores both objects normalised and answers the export form", async function () {
      const res = await save({
        heroLayout: MINIMAL_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(200);
      expect(writtenLayout()).to.deep.equal(MINIMAL_LAYOUT_STORED);
      expect(writtenBackground()).to.deep.equal(COLOR_BACKGROUND);
      expect(Object.keys(res.body).sort()).to.deep.equal([
        "background",
        "heroLayout",
        "name",
      ]);
      expect(res.body.name).to.equal(CATALOG_NAME);
      expect(res.body.background).to.deep.equal(COLOR_BACKGROUND);
      expect(res.body.heroLayout.blocks[2].image).to.deep.equal(
        enriched(LAYOUT_MEDIA_ID),
      );
    });

    it("stores the alignment, offset and layer of a Block", async function () {
      const res = await save({
        heroLayout: layoutOf(PLACED_BLOCK),
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(200);
      expect(writtenLayout().blocks[0]).to.deep.equal({
        ...PLACED_BLOCK,
        ...FILLED_BLOCK_DEFAULTS,
        align: "center",
        offset: { x: -1.5, y: 0.5 },
        layer: "front",
        size: "md",
        color: "default",
        weight: "normal",
        shadow: false,
      });
      expect(placementOf(res.body.heroLayout)).to.deep.equal(
        placementOf(writtenLayout()),
      );
    });

    it("stores the two legacy Panel words normalised", async function () {
      const res = await save({
        heroLayout: layoutOf(
          { ...MINIMAL_TEXT_BLOCK, panel: "none" },
          { ...MINIMAL_TEXT_BLOCK, id: "t2", panel: "translucent" },
        ),
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(200);
      expect(writtenLayout().blocks.map((block) => block.panel)).to.deep.equal([
        null,
        GLAS_PANEL,
      ]);
      expect(panelsOf(res.body)).to.deep.equal([null, GLAS_PANEL]);
    });

    it("writes the catalog, then the instance, then flushes the cache once", async function () {
      await save({ heroLayout: MINIMAL_LAYOUT, background: COLOR_BACKGROUND });

      sinon.assert.callOrder(
        CatalogManager.updateCatalog,
        InstanceManager.updateBackground,
        ThemeExportCache.invalidateAll,
      );
      expect(ThemeExportCache.invalidateAll.callCount).to.equal(1);
    });

    // The catalog is already written when the Background write fails, so the
    // cached bundles no longer match the stored layout. Leaving them would
    // serve the old Hero under its old tag for the life of the process, and
    // the cache has no TTL to age it out.
    it("flushes the cache even when the Background write fails", async function () {
      InstanceManager.updateBackground.rejects(new Error("mongo is down"));

      const res = await save({
        heroLayout: MINIMAL_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(500);
      sinon.assert.calledOnce(CatalogManager.updateCatalog);
      expect(ThemeExportCache.invalidateAll.callCount).to.equal(1);
    });

    it("changes the Theme Bundle ETag", async function () {
      stored();
      const before = await get("/catalog/themes", ADMIN);

      await save({ heroLayout: MINIMAL_LAYOUT, background: COLOR_BACKGROUND });

      stored({
        heroLayout: writtenLayout(),
        background: writtenBackground(),
      });
      const after = await get("/catalog/themes", ADMIN);

      expect(after.headers.etag).to.not.equal(before.headers.etag);
      expect(after.body.background).to.deep.equal(COLOR_BACKGROUND);
    });

    it("takes null for both and answers the derived defaults", async function () {
      const res = await save({ heroLayout: null, background: null });

      expect(res.status).to.equal(200);
      expect(writtenLayout()).to.equal(null);
      expect(writtenBackground()).to.equal(null);
      expect(res.body.background).to.deep.equal(VARIANT_BACKGROUND);
      expect(res.body.heroLayout.blocks.map((b) => b.id)).to.deep.equal([
        "default-title",
        "default-subtitle",
      ]);
    });

    it("writes nothing and names every fault of both objects", async function () {
      const res = await save({
        heroLayout: layoutOf({ ...MINIMAL_TEXT_BLOCK, zone: "middle" }),
        background: { version: 1, type: "color", light: "#fff", glow: 1 },
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal("ValidationError");
      expect(codesOf(res.body)).to.deep.equal([
        { field: "heroLayout.blocks[0].zone", code: "invalid_enum" },
        { field: "background.light", code: "invalid_format" },
        { field: "background.glow", code: "unknown_field" },
      ]);
      expect(CatalogManager.updateCatalog.called).to.equal(false);
      expect(InstanceManager.updateBackground.called).to.equal(false);
      expect(ThemeExportCache.invalidateAll.called).to.equal(false);
    });

    it("refuses a body that names neither object", async function () {
      const res = await save({});

      expect(res.status).to.equal(400);
      expect(codesOf(res.body)).to.deep.equal([
        { field: "heroLayout", code: "required" },
        { field: "background", code: "required" },
      ]);
      expect(CatalogManager.updateCatalog.called).to.equal(false);
    });

    it("answers a missing instance catalog with 404 and leaves the instance alone", async function () {
      CatalogManager.updateCatalog.resolves(null);

      const res = await save({ heroLayout: null, background: null });

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("instance_catalog_not_found");
      expect(InstanceManager.updateBackground.called).to.equal(false);
    });
  });

  describe("the Theme Bundle of a layout stored before the amendment", function () {
    it("delivers it complete, without a migration", async function () {
      stored({ heroLayout: preAmendmentLayout() });

      const bundle = await get("/catalog/themes", ADMIN);

      expect(bundle.status).to.equal(200);
      expect(bundle.body.heroLayout).to.deep.equal(PRE_AMENDMENT_EXPORTED);
    });
  });

  describe("the acceptance fixture of the Shared contract", function () {
    // The Bad Belzig Hero is the amendment's own walk: it names every field
    // the amendment added, and it is written the way the contract writes it -
    // every default filled - so what a save stores and what a read answers can
    // be compared to the fixture key by key rather than only value by value.
    it("goes in through PUT and comes back out of GET byte-identically", async function () {
      const saved = await save({
        heroLayout: ACCEPTANCE_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      expect(saved.status).to.equal(200);
      expect(JSON.stringify(writtenLayout())).to.equal(
        JSON.stringify(ACCEPTANCE_LAYOUT),
      );

      stored({ heroLayout: writtenLayout(), background: writtenBackground() });
      const read = await readEditor();

      expect(read.status).to.equal(200);
      expect(JSON.stringify(read.body.heroLayout)).to.equal(
        JSON.stringify(saved.body.heroLayout),
      );
      expect(read.body.heroLayout.blocks[0].image).to.deep.equal(
        enriched(CREST_MEDIA_ID),
      );
    });

    it("keeps the classes of its two headline lines, unrepaired", async function () {
      const saved = await save({
        heroLayout: ACCEPTANCE_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      // The class pass reads `hero-size-*` and `hero-color-*` on a span as
      // the vocabulary it keeps, so the stored HTML is the HTML that was
      // sent - character for character, both lines.
      expect(writtenLayout().blocks[1].html).to.deep.equal(
        ACCEPTANCE_LAYOUT.blocks[1].html,
      );
      expect(saved.body.heroLayout.blocks[1].html).to.deep.equal(
        ACCEPTANCE_LAYOUT.blocks[1].html,
      );
    });

    it("changes the Theme Bundle tag and goes out with the crest enriched", async function () {
      stored();
      const before = await get("/catalog/themes", ADMIN);

      await save({
        heroLayout: ACCEPTANCE_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      stored({ heroLayout: writtenLayout(), background: writtenBackground() });
      const bundle = await get("/catalog/themes", ADMIN);

      expect(bundle.status).to.equal(200);
      expect(bundle.headers.etag).to.not.equal(before.headers.etag);
      expect(bundle.body.heroLayout.blocks[0].image).to.deep.equal(
        enriched(CREST_MEDIA_ID),
      );
    });
  });

  describe("POST /api/catalog/hero-layout/preview", function () {
    it("answers the export form without writing anything", async function () {
      const res = await preview({
        heroLayout: MINIMAL_LAYOUT,
        background: IMAGE_BACKGROUND,
        name: "Vorschau",
      });

      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal("Vorschau");
      expect(res.body.heroLayout.blocks[2].image).to.deep.equal(
        enriched(LAYOUT_MEDIA_ID),
      );
      expect(res.body.background.image).to.deep.equal(enriched(IMAGE_MEDIA_ID));
      expect(CatalogManager.updateCatalog.called).to.equal(false);
      expect(InstanceManager.updateBackground.called).to.equal(false);
      expect(ThemeExportCache.invalidateAll.called).to.equal(false);
    });

    it("answers the same layout a save would store", async function () {
      const saved = await save({
        heroLayout: MINIMAL_LAYOUT,
        background: COLOR_BACKGROUND,
      });
      const previewed = await preview({
        heroLayout: MINIMAL_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      expect(previewed.body).to.deep.equal(saved.body);
    });

    it("answers the placement of a Block without storing it", async function () {
      const res = await preview({
        heroLayout: layoutOf(PLACED_BLOCK),
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(200);
      expect(placementOf(res.body.heroLayout)).to.deep.equal([
        { align: "center", offset: { x: -1.5, y: 0.5 }, layer: "front" },
      ]);
      expect(CatalogManager.updateCatalog.called).to.equal(false);
    });

    it("answers the two legacy Panel words normalised", async function () {
      const res = await preview({
        heroLayout: layoutOf(
          { ...MINIMAL_TEXT_BLOCK, panel: "none" },
          { ...MINIMAL_TEXT_BLOCK, id: "t2", panel: "translucent" },
        ),
        background: COLOR_BACKGROUND,
      });

      expect(res.status).to.equal(200);
      expect(panelsOf(res.body)).to.deep.equal([null, GLAS_PANEL]);
      expect(CatalogManager.updateCatalog.called).to.equal(false);
    });

    it("answers the derived defaults for both nulls", async function () {
      stored({ logo: BRANDING_LOGO });

      const res = await preview({
        heroLayout: null,
        background: null,
        name: PORTAL_NAME,
      });

      expect(res.status).to.equal(200);
      expect(res.body.background).to.deep.equal(VARIANT_BACKGROUND);
      expect(res.body.heroLayout).to.deep.equal({
        ...DEFAULT_HERO_LAYOUT,
        blocks: DEFAULT_HERO_LAYOUT.blocks.map((block) =>
          block.type === "image"
            ? { ...block, image: enriched(LOGO_MEDIA_ID) }
            : block,
        ),
      });
    });

    it("reads the Portal Name of the catalog when the body names none", async function () {
      stored();

      const res = await preview({ heroLayout: null, background: null });

      expect(res.body.name).to.equal(CATALOG_NAME);
      expect(res.body.heroLayout.blocks[0].text).to.deep.equal({
        de: CATALOG_NAME,
      });
    });

    it("answers invalid input with 400 and JSON paths", async function () {
      const res = await preview({
        heroLayout: layoutOf({ ...MINIMAL_TEXT_BLOCK, size: "3xl" }),
        background: { version: 2, type: "variant" },
      });

      expect(res.status).to.equal(400);
      expect(codesOf(res.body)).to.deep.equal([
        { field: "heroLayout.blocks[0].size", code: "invalid_enum" },
        { field: "background.version", code: "invalid_enum" },
        { field: "background.variant", code: "required" },
      ]);
    });

    it("leaves the Theme Bundle tag alone", async function () {
      stored();
      const before = await get("/catalog/themes", ADMIN);

      await preview({
        heroLayout: MINIMAL_LAYOUT,
        background: COLOR_BACKGROUND,
      });

      const after = await get("/catalog/themes", ADMIN);

      expect(after.headers.etag).to.equal(before.headers.etag);
    });
  });

  describe("the rights of the three routes", function () {
    const ROUTES = [
      ["get", "/catalog/hero-layout"],
      ["put", "/catalog/hero-layout"],
      ["post", "/catalog/hero-layout/preview"],
    ];

    const call = (method, path, userId) =>
      method === "get"
        ? get(path, userId)
        : method === "put"
          ? put(path, userId, {})
          : post(path, userId, {});

    for (const [method, path] of ROUTES) {
      it(`refuses the anonymous on ${method.toUpperCase()} ${path}`, async function () {
        const res = await call(method, path, null);

        expect(res.status).to.equal(401);
      });

      it(`refuses the tenant owner on ${method.toUpperCase()} ${path}`, async function () {
        const res = await call(method, path, OWNER);

        expect(res.status).to.equal(403);
      });
    }
  });
});
