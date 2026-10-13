/**
 * The source „App-Logo“ of a Hero image Block (ECCdigital/tickets#522, map
 * #510): a Block stores `image: { source: "app-logo" }` instead of a copied
 * media id and follows the app logo of the branding, its variant for the dark
 * mode included. The backend puts URL and dimensions of both in on the way
 * out; without an app logo, or with the branding switched off, the Block
 * carries no image. The Default Hero Layout derives its logo Block with the
 * source, and a stored layout that holds the copied media id stays as it is.
 *
 * The seam is "save the instance, read the Theme Bundle": the real instance
 * manager runs behind `PUT /api/instances`, over a model that keeps the stored
 * instance of the harness, and the Hero Layout is saved through the Hero
 * Editor's route onto a catalog kept here.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const {
  MINIMAL_IMAGE_BLOCK,
  layoutOf,
} = require("./fixtures/hero-layout/layouts");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const Instance = require("../src/commons/entities/instance/instance");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const { Media } = require("../src/commons/entities/media/media");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

// The app logo and its variant, public images of the instance library.
const LOGO = "app-logo-light";
const DARK = "app-logo-dark";

const fileUrl = (mediaId) => `/api/v2/instance/media/${mediaId}/file`;

const instanceImage = (id, width, height) =>
  new Media({
    id,
    tenantId: null,
    kind: "image",
    mimeType: "image/png",
    size: 7,
    originalFileName: `${id}.png`,
    uploadedBy: ADMIN,
    visibility: "public",
    storage: { provider: "s3", key: "fx" },
    width,
    height,
  });

const reference = (mediaId) => ({ source: "media", mediaId });

/** An image Block that follows the app logo. */
const APP_LOGO_BLOCK = Object.freeze({
  ...MINIMAL_IMAGE_BLOCK,
  id: "crest",
  image: { source: "app-logo" },
  alt: { de: "Wappen" },
  maxHeight: "md",
});

/** An image Block that holds a copy of the app logo's media id. */
const COPIED_LOGO_BLOCK = Object.freeze({
  ...MINIMAL_IMAGE_BLOCK,
  id: "copied",
  image: reference(LOGO),
  alt: { de: "Wappen" },
  maxHeight: "sm",
  invertInDarkMode: true,
});

describe("the source App-Logo of a Hero image Block", function () {
  this.timeout(20000);

  let h;
  let kept;
  let fixtureCatalog;
  let catalog;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
      instance: { isInitialized: true },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });

    MediaManager.getMedia
      .withArgs(LOGO)
      .resolves(instanceImage(LOGO, 640, 320));
    MediaManager.getMedia
      .withArgs(DARK)
      .resolves(instanceImage(DARK, 600, 300));

    // The model keeps the harness' stored instance: a write replaces it as
    // the database would, and every read of the instance sees the result —
    // the branding read of the Theme Bundle included, lean as stored.
    const stored = () => ({
      ...clone(h.instance),
      toEntity: () => new Instance(clone(h.instance)),
    });
    InstanceManager.updateInstance.restore();
    InstanceManager.getBranding.restore();
    InstanceModel.findOne.callsFake(async () => stored());
    InstanceModel.findOne
      .withArgs({}, sinon.match.has("branding"))
      .returns({ lean: async () => clone(h.instance) });
    sinon
      .stub(InstanceModel, "findOneAndUpdate")
      .callsFake(async (filter, { $set }) => {
        replaceStored(clone($set));
        return stored();
      });
    sinon.stub(InstanceModel.collection, "updateOne").resolves();

    // The instance catalog keeps what the Hero Editor's save writes.
    fixtureCatalog = await CatalogManager.getInstanceCatalog();
    CatalogManager.getInstanceCatalog.callsFake(async () => catalog);
    CatalogManager.updateCatalog.callsFake(async (data) => {
      catalog = new Catalog({ ...catalog, ...clone(data) });
      return catalog;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  function replaceStored(record) {
    for (const key of Object.keys(h.instance)) delete h.instance[key];
    Object.assign(h.instance, record);
  }

  beforeEach(function () {
    kept = clone(h.instance);
    catalog = new Catalog({ ...fixtureCatalog, name: "Musterstadt" });
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });

  afterEach(function () {
    replaceStored(kept);
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });

  /** Saves the instance with the given branding, as the tab „Portal“ does. */
  const saveInstance = (branding) =>
    h
      .api()
      .put("/api/instances")
      .set(h.as(ADMIN))
      .send({ ownerUserIds: [ADMIN], isInitialized: true, branding });

  /** Saves the Hero as the Hero Editor does. */
  const saveHero = (heroLayout) =>
    h
      .api()
      .put("/api/catalog/hero-layout")
      .set(h.as(ADMIN))
      .send({ heroLayout, background: null });

  const themeBundle = () => h.api().get("/api/catalog/themes").set(h.as(ADMIN));

  const branded = (overrides = {}) => ({
    active: true,
    theme: { colors: { primary: "#123456", secondary: "#654321" } },
    logo: reference(LOGO),
    logoDark: reference(DARK),
    ...overrides,
  });

  /** Saves branding and layout, then answers the Blocks of the bundle. */
  async function deliveredBlocks(branding, heroLayout) {
    expect((await saveInstance(branding)).status).to.equal(200);
    if (heroLayout !== undefined) {
      expect((await saveHero(heroLayout)).status).to.equal(200);
    }

    const bundle = await themeBundle();
    expect(bundle.status).to.equal(200);

    return bundle.body.heroLayout.blocks;
  }

  describe("a stored layout", function () {
    it("delivers the app logo and its variant with URL and dimensions", async function () {
      const [block] = await deliveredBlocks(
        branded(),
        layoutOf(APP_LOGO_BLOCK),
      );

      expect(block.image).to.deep.equal({
        source: "app-logo",
        url: fileUrl(LOGO),
        width: 640,
        height: 320,
        dark: { url: fileUrl(DARK), width: 600, height: 300 },
      });
    });

    it("keeps the rest of the Block and carries no invert switch", async function () {
      const [block] = await deliveredBlocks(
        branded(),
        layoutOf(APP_LOGO_BLOCK),
      );

      expect(block).to.include({ id: "crest", type: "image", maxHeight: "md" });
      expect(block.alt).to.deep.equal({ de: "Wappen" });
      expect(block).to.not.have.property("invertInDarkMode");
    });

    it("follows a new app logo without saving the layout again", async function () {
      await deliveredBlocks(branded(), layoutOf(APP_LOGO_BLOCK));

      const [block] = await deliveredBlocks(
        branded({ logo: reference(FIXTURE_ID), logoDark: null }),
      );

      expect(block.image).to.deep.include({
        source: "app-logo",
        url: fileUrl(FIXTURE_ID),
        dark: null,
      });
    });

    it("delivers dark null without a variant", async function () {
      const [block] = await deliveredBlocks(
        branded({ logoDark: null }),
        layoutOf(APP_LOGO_BLOCK),
      );

      expect(block.image).to.deep.equal({
        source: "app-logo",
        url: fileUrl(LOGO),
        width: 640,
        height: 320,
        dark: null,
      });
    });

    it("delivers no image without an app logo, even with a variant", async function () {
      const [block] = await deliveredBlocks(
        branded({ logo: null }),
        layoutOf(APP_LOGO_BLOCK),
      );

      expect(block.image).to.deep.equal({
        source: "app-logo",
        url: null,
        width: null,
        height: null,
        dark: null,
      });
    });

    it("delivers no image while the branding is switched off", async function () {
      const [block] = await deliveredBlocks(
        branded({ active: false }),
        layoutOf(APP_LOGO_BLOCK),
      );

      expect(block.image).to.deep.equal({
        source: "app-logo",
        url: null,
        width: null,
        height: null,
        dark: null,
      });
    });

    it("leaves a Block with the copied media id of the app logo as it is", async function () {
      const blocks = await deliveredBlocks(
        branded(),
        layoutOf(COPIED_LOGO_BLOCK, APP_LOGO_BLOCK),
      );

      expect(catalog.heroLayout.blocks[0]).to.deep.include({
        image: reference(LOGO),
        invertInDarkMode: true,
      });
      expect(blocks[0].image).to.deep.equal({
        ...reference(LOGO),
        url: fileUrl(LOGO),
        width: 640,
        height: 320,
      });
      expect(blocks[0].invertInDarkMode).to.equal(true);
    });

    it("stores the source alone, without a media id", async function () {
      await deliveredBlocks(branded(), layoutOf(APP_LOGO_BLOCK));

      expect(catalog.heroLayout.blocks[0].image).to.deep.equal({
        source: "app-logo",
      });
      expect(catalog.heroLayout.blocks[0]).to.not.have.property(
        "invertInDarkMode",
      );
    });
  });

  describe("the Default Hero Layout", function () {
    it("derives its logo Block with the source and delivers the app logo", async function () {
      const [block] = await deliveredBlocks(branded());

      expect(block.id).to.equal("default-logo");
      expect(block).to.not.have.property("invertInDarkMode");
      expect(block.image).to.deep.equal({
        source: "app-logo",
        url: fileUrl(LOGO),
        width: 640,
        height: 320,
        dark: { url: fileUrl(DARK), width: 600, height: 300 },
      });
    });

    it("has no logo Block without an app logo", async function () {
      const blocks = await deliveredBlocks(branded({ logo: null }));

      expect(blocks.map((block) => block.id)).to.deep.equal([
        "default-title",
        "default-subtitle",
      ]);
    });

    it("has no logo Block while the branding is switched off", async function () {
      const blocks = await deliveredBlocks(branded({ active: false }));

      expect(blocks.map((block) => block.id)).to.deep.equal([
        "default-title",
        "default-subtitle",
      ]);
    });
  });

  describe("the Hero Editor", function () {
    it("reads the app logo and its variant into a Block that follows it", async function () {
      await deliveredBlocks(branded(), layoutOf(APP_LOGO_BLOCK));

      const res = await h
        .api()
        .get("/api/catalog/hero-layout")
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.heroLayout.blocks[0].image).to.deep.equal({
        source: "app-logo",
        url: fileUrl(LOGO),
        width: 640,
        height: 320,
        dark: { url: fileUrl(DARK), width: 600, height: 300 },
      });
    });

    it("answers the app logo on save and takes the answer back unchanged", async function () {
      expect((await saveInstance(branded())).status).to.equal(200);

      const first = await saveHero(layoutOf(APP_LOGO_BLOCK));
      expect(first.status).to.equal(200);
      expect(first.body.heroLayout.blocks[0].image.url).to.equal(fileUrl(LOGO));

      const second = await saveHero(first.body.heroLayout);

      expect(second.status).to.equal(200);
      expect(catalog.heroLayout.blocks[0].image).to.deep.equal({
        source: "app-logo",
      });
      expect(second.body).to.deep.equal(first.body);
    });

    it("previews a Block that follows the app logo with it", async function () {
      expect((await saveInstance(branded())).status).to.equal(200);

      const res = await h
        .api()
        .post("/api/catalog/hero-layout/preview")
        .set(h.as(ADMIN))
        .send({ heroLayout: layoutOf(APP_LOGO_BLOCK), background: null });

      expect(res.status).to.equal(200);
      expect(res.body.heroLayout.blocks[0].image.dark).to.deep.equal({
        url: fileUrl(DARK),
        width: 600,
        height: 300,
      });
    });

    it("refuses a media id and the invert switch on a Block that follows the app logo", async function () {
      expect((await saveInstance(branded())).status).to.equal(200);

      const res = await saveHero(
        layoutOf({
          ...APP_LOGO_BLOCK,
          image: { source: "app-logo", mediaId: LOGO },
          invertInDarkMode: true,
        }),
      );

      expect(res.status).to.equal(400);
      expect(
        res.body.details.map(({ field, code }) => ({ field, code })),
      ).to.deep.equal([
        {
          field: "heroLayout.blocks[0].image.mediaId",
          code: "unknown_field",
        },
        {
          field: "heroLayout.blocks[0].invertInDarkMode",
          code: "unknown_field",
        },
      ]);
    });
  });
});
