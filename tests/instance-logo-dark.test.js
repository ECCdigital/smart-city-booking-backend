/**
 * The variant of the app logo for the dark mode, `branding.logoDark`
 * (ECCdigital/tickets#521, map #510): `PUT /api/instances` stores it as a
 * reference to a public image of the instance library or null, the Theme
 * Bundle delivers it enriched under `branding.active`, and a medium that
 * serves as the variant cannot be deleted. The real manager runs behind the
 * routes, over a model that keeps the stored instance of the harness.
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
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const Instance = require("../src/commons/entities/instance/instance");
const { Media } = require("../src/commons/entities/media/media");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

// Media of the instance library besides the fixture medium of the route
// world: the variant with its dimensions, an internal image and a public
// document.
const DARK = "logo-dark";
const INTERN = "logo-dark-intern";
const DOCUMENT = "logo-dark-document";

const instanceMedium = (overrides) =>
  new Media({
    tenantId: null,
    kind: "image",
    mimeType: "image/png",
    size: 7,
    originalFileName: "logo-dunkel.png",
    uploadedBy: ADMIN,
    visibility: "public",
    storage: { provider: "s3", key: "fx" },
    ...overrides,
  });

const reference = (mediaId) => ({ source: "media", mediaId });

describe("Variant of the app logo for the dark mode", function () {
  this.timeout(20000);

  let h;
  let kept;

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
      .withArgs(DARK)
      .resolves(instanceMedium({ id: DARK, width: 320, height: 80 }));
    MediaManager.getMedia
      .withArgs(INTERN)
      .resolves(instanceMedium({ id: INTERN, visibility: "intern" }));
    MediaManager.getMedia.withArgs(DOCUMENT).resolves(
      instanceMedium({
        id: DOCUMENT,
        kind: "document",
        mimeType: "application/pdf",
        originalFileName: "logo.pdf",
      }),
    );

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
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });

  afterEach(function () {
    replaceStored(kept);
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });

  /** Saves the instance with the given branding, as the tab „Portal“ does. */
  const save = (branding) =>
    h
      .api()
      .put("/api/instances")
      .set(h.as(ADMIN))
      .send({ ownerUserIds: [ADMIN], isInitialized: true, branding });

  const themeBundle = () => h.api().get("/api/catalog/themes").set(h.as(ADMIN));

  const branded = (overrides = {}) => ({
    active: true,
    theme: { colors: { primary: "#123456", secondary: "#654321" } },
    logo: reference(FIXTURE_ID),
    ...overrides,
  });

  describe("saving and delivering", function () {
    it("delivers the stored variant in the Theme Bundle with its URL and dimensions", async function () {
      const res = await save(branded({ logoDark: reference(DARK) }));
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.logoDark).to.deep.equal({
        source: "media",
        mediaId: DARK,
        url: `/api/v2/instance/media/${DARK}/file`,
        width: 320,
        height: 80,
      });
    });

    it("delivers no variant while the branding is switched off, and keeps the stored one", async function () {
      const res = await save(
        branded({ active: false, logoDark: reference(DARK) }),
      );
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body).to.include({ active: false, logoDark: null });

      const instance = await h.api().get("/api/instances").set(h.as(ADMIN));
      expect(instance.body.branding.logoDark).to.include(reference(DARK));
    });

    it("stores no variant when the save names none", async function () {
      const res = await save(branded());
      expect(res.status).to.equal(200);

      expect(h.instance.branding.logoDark).to.equal(null);
      expect((await themeBundle()).body.logoDark).to.equal(null);
    });

    it("removes the variant with null", async function () {
      expect(
        (await save(branded({ logoDark: reference(DARK) }))).status,
      ).to.equal(200);

      const res = await save(branded({ logoDark: null }));

      expect(res.status).to.equal(200);
      expect(h.instance.branding.logoDark).to.equal(null);
      expect((await themeBundle()).body.logoDark).to.equal(null);
    });

    it("stores the reference alone, without what the export added", async function () {
      const res = await save(
        branded({
          logoDark: {
            ...reference(DARK),
            url: `/api/v2/instance/media/${DARK}/file`,
            width: 320,
            height: 80,
          },
        }),
      );

      expect(res.status).to.equal(200);
      expect(h.instance.branding.logoDark).to.deep.equal(reference(DARK));
    });

    it("hands the variant to the Admin UI with its URL", async function () {
      expect(
        (await save(branded({ logoDark: reference(DARK) }))).status,
      ).to.equal(200);

      const res = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.branding.logoDark).to.deep.equal({
        source: "media",
        mediaId: DARK,
        url: `/api/v2/instance/media/${DARK}/file`,
      });
    });
  });

  describe("the ETag of the Theme Bundle", function () {
    it("changes when the variant is set, changed and removed", async function () {
      const tags = [];

      for (const logoDark of [
        null,
        reference(DARK),
        reference(FIXTURE_ID),
        null,
      ]) {
        expect((await save(branded({ logoDark }))).status).to.equal(200);
        const bundle = await themeBundle();
        expect(bundle.headers.etag).to.match(/^"[0-9a-f]{16}"$/);
        tags.push(bundle.headers.etag);
      }

      expect(tags[1]).to.not.equal(tags[0]);
      expect(tags[2]).to.not.equal(tags[1]);
      expect(tags[3]).to.not.equal(tags[2]);
      expect(tags[3]).to.equal(tags[0]);
    });
  });

  describe("a medium in use as the variant", function () {
    const valueAt = (record, path) =>
      path.split(".").reduce((value, key) => value?.[key], record);

    before(function () {
      // The usage proof searches the stored instance by the reference paths
      // of the branding, as the database would.
      InstanceManager.getMediaUsage.restore();
      InstanceManager.getBrandingMediaUsage.restore();
      InstanceModel.findOne
        .withArgs(sinon.match.has("$or"), { _id: 1 })
        .callsFake((filter) => ({
          lean: async () =>
            filter.$or.some((condition) =>
              Object.entries(condition).every(
                ([path, mediaId]) => valueAt(h.instance, path) === mediaId,
              ),
            )
              ? { _id: "instance" }
              : null,
        }));
    });

    beforeEach(async function () {
      expect(
        (await save(branded({ logoDark: reference(DARK) }))).status,
      ).to.equal(200);
    });

    it("cannot be deleted", async function () {
      const res = await h
        .api()
        .delete(`/api/v2/instance/media/${DARK}`)
        .set(h.as(ADMIN));

      // `media_in_use` answers the usage proof itself as its body.
      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal([
        { type: "instance", id: null, title: "instance" },
      ]);
    });

    it("cannot turn internal", async function () {
      const res = await h
        .api()
        .patch(`/api/v2/instance/media/${DARK}`)
        .set(h.as(ADMIN))
        .send({ visibility: "intern" });

      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal([
        { type: "instance", id: null, title: "instance" },
      ]);
    });
  });

  describe("refusing on save", function () {
    for (const [name, logoDark, code, params] of [
      [
        "an internal image",
        reference(INTERN),
        "media_reference_not_public",
        { mediaId: INTERN },
      ],
      [
        "a document",
        reference(DOCUMENT),
        "media_reference_wrong_kind",
        { mediaId: DOCUMENT, kind: "image" },
      ],
      [
        "an unknown medium",
        reference("missing"),
        "media_reference_unknown",
        { mediaId: "missing" },
      ],
    ]) {
      it(`refuses ${name} with 400 and keeps the instance`, async function () {
        const before = clone(h.instance);

        const res = await save(branded({ logoDark }));

        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal(code);
        expect(res.body.params).to.deep.equal(params);
        expect(h.instance).to.deep.equal(before);
      });
    }

    for (const [name, logoDark, detail] of [
      [
        "a foreign address",
        { source: "external", url: "https://example.org/logo.png" },
        {
          field: "branding.logoDark.source",
          code: "invalid_enum",
          params: { allowed: ["media"] },
        },
      ],
      [
        "a bare URL",
        "https://example.org/logo.png",
        {
          field: "branding.logoDark",
          code: "invalid_format",
          params: { format: "media_reference" },
        },
      ],
      [
        "a reference without a medium",
        { source: "media" },
        { field: "branding.logoDark.mediaId", code: "required" },
      ],
    ]) {
      it(`refuses ${name} with 400 and keeps the instance`, async function () {
        const before = clone(h.instance);

        const res = await save(branded({ logoDark }));

        expect(res.status).to.equal(400);
        expect(res.body.details).to.deep.equal([detail]);
        expect(h.instance).to.deep.equal(before);
      });
    }
  });

  describe("an instance stored before the variant", function () {
    beforeEach(function () {
      // As the database holds it: branded, with a logo, without a variant.
      h.instance.branding = {
        active: true,
        theme: { colors: { primary: "#123456", secondary: "#654321" } },
        logo: reference(FIXTURE_ID),
        favicon: null,
        logoUrl: "",
        faviconUrl: "",
      };
    });

    it("delivers no variant in the Theme Bundle", async function () {
      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.logo).to.include(reference(FIXTURE_ID));
      expect(bundle.body.logoDark).to.equal(null);
    });

    it("reads no variant in the instance", async function () {
      const res = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.branding.logoDark).to.equal(null);
    });
  });
});
