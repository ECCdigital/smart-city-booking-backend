/**
 * The font of the instance in `branding.font` (ECCdigital/tickets#524, map
 * #510): the system font (`null`), one of the curated list, or a font of the
 * instance library with a confirmed web licence. `PUT /api/instances` checks
 * and stores it, stamping who confirmed the licence and when from the
 * session; the Theme Bundle delivers it under `branding.active`, without the
 * licence; a font in use cannot be deleted. The real manager runs behind the
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
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const Instance = require("../src/commons/entities/instance/instance");
const { Media } = require("../src/commons/entities/media/media");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

const FONT_ID = "font-house-sans";
const OTHER_FONT_ID = "font-house-serif";
const INTERN_FONT_ID = "font-intern";
const IMAGE_ID = "image-logo";

const CURATED_IDS = [
  "inter",
  "open-sans",
  "roboto",
  "noto-sans",
  "public-sans",
  "atkinson-hyperlegible-next",
  "ibm-plex-sans",
  "figtree",
  "noto-serif",
];

/** A medium of the instance library. */
function instanceMedium(id, overrides = {}) {
  return new Media({
    id,
    tenantId: null,
    kind: "font",
    mimeType: "font/woff2",
    size: 48213,
    originalFileName: `${id}.woff2`,
    title: "House Sans",
    uploadedBy: ADMIN,
    visibility: "public",
    storage: { provider: "s3", key: `instance/media/${id}/original.woff2` },
    ...overrides,
  });
}

const LIBRARY = {
  [FONT_ID]: instanceMedium(FONT_ID),
  [OTHER_FONT_ID]: instanceMedium(OTHER_FONT_ID, {
    title: "House Serif",
    size: 61000,
  }),
  [INTERN_FONT_ID]: instanceMedium(INTERN_FONT_ID, { visibility: "intern" }),
  [IMAGE_ID]: instanceMedium(IMAGE_ID, {
    kind: "image",
    mimeType: "image/png",
    originalFileName: "logo.png",
    width: 200,
    height: 80,
  }),
};

/**
 * Whether the stored instance matches one of the alternatives of a usage
 * filter: each a dotted path to a media id, as Mongo reads it.
 */
function matchesUsage(instance, filter) {
  return filter.$or.some((alternative) =>
    Object.entries(alternative).every(
      ([path, mediaId]) =>
        path.split(".").reduce((value, key) => value?.[key], instance) ===
        mediaId,
    ),
  );
}

describe("Font of the instance in the branding", function () {
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

    // The model keeps the harness' stored instance: a write replaces it as
    // the database would, and every read of the instance sees the result —
    // the branding read of the Theme Bundle and the usage proof included.
    const stored = () => ({
      ...clone(h.instance),
      toEntity: () => new Instance(clone(h.instance)),
    });
    InstanceManager.updateInstance.restore();
    InstanceManager.getBranding.restore();
    InstanceManager.getMediaUsage.restore();
    InstanceModel.findOne.callsFake(async () => stored());
    InstanceModel.findOne
      .withArgs({}, sinon.match.has("branding"))
      .returns({ lean: async () => clone(h.instance) });
    InstanceModel.findOne
      .withArgs(sinon.match.has("$or"))
      .callsFake((filter) => ({
        lean: async () =>
          matchesUsage(h.instance, filter) ? { _id: "instance" } : null,
      }));
    sinon
      .stub(InstanceModel, "findOneAndUpdate")
      .callsFake(async (filter, { $set }) => {
        replaceStored(clone($set));
        return stored();
      });
    sinon.stub(InstanceModel.collection, "updateOne").resolves();

    // The instance library holds the fonts and the image above.
    MediaManager.getMedia.callsFake(async (id, tenantId) =>
      tenantId == null ? LIBRARY[id] ?? null : null,
    );
    sinon.stub(MediaService, "deleteMedia").resolves();
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

  const branded = (font, overrides = {}) => ({
    active: true,
    theme: { colors: { primary: "#123456", secondary: "#654321" } },
    font,
    ...overrides,
  });

  const curated = (id) => ({ source: "curated", id });

  /** A font of the library, with the licence ticked as the form sends it. */
  const ownFont = (mediaId, license = { confirmed: true }) => ({
    source: "media",
    reference: { source: "media", mediaId },
    license,
  });

  describe("the system font", function () {
    it("is the default of an instance that never chose a font", async function () {
      h.instance.branding = {
        active: true,
        theme: { colors: { primary: "#123456", secondary: "#654321" } },
      };

      const bundle = await themeBundle();
      const instance = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(bundle.status).to.equal(200);
      expect(bundle.body.font).to.equal(null);
      expect(instance.body.branding.font).to.equal(null);
    });

    it("is stored as null", async function () {
      expect((await save(branded(curated("inter")))).status).to.equal(200);

      const res = await save(branded(null));

      expect(res.status).to.equal(200);
      expect(h.instance.branding.font).to.equal(null);
      expect((await themeBundle()).body.font).to.equal(null);
    });
  });

  describe("a font of the curated list", function () {
    for (const id of CURATED_IDS) {
      it(`stores and delivers ${id}`, async function () {
        const res = await save(branded(curated(id)));
        expect(res.status).to.equal(200);

        expect(h.instance.branding.font).to.deep.equal(curated(id));
        expect((await themeBundle()).body.font).to.deep.equal(curated(id));
      });
    }

    it("refuses an id outside the list with 400 and keeps the instance", async function () {
      const before = clone(h.instance);

      const res = await save(branded(curated("comic-sans")));

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([
        {
          field: "branding.font.id",
          code: "invalid_enum",
          params: { allowed: CURATED_IDS },
        },
      ]);
      expect(h.instance).to.deep.equal(before);
    });

    it("stores no licence for a curated font", async function () {
      const res = await save(
        branded({ ...curated("figtree"), license: { confirmed: true } }),
      );

      expect(res.status).to.equal(200);
      expect(h.instance.branding.font).to.deep.equal(curated("figtree"));
    });
  });

  describe("a font of the library", function () {
    it("stores who confirmed the licence and when, from the session", async function () {
      const before = Date.now();

      const res = await save(branded(ownFont(FONT_ID)));

      expect(res.status).to.equal(200);
      const font = h.instance.branding.font;
      expect(font.source).to.equal("media");
      expect(font.reference).to.deep.equal({
        source: "media",
        mediaId: FONT_ID,
      });
      expect(Object.keys(font.license)).to.have.members([
        "confirmedAt",
        "confirmedBy",
      ]);
      expect(font.license.confirmedBy).to.equal(ADMIN);
      expect(Date.parse(font.license.confirmedAt)).to.be.within(
        before,
        Date.now(),
      );
    });

    it("never takes the person or the time of the licence from the form", async function () {
      const res = await save(
        branded(
          ownFont(FONT_ID, {
            confirmed: true,
            confirmedAt: "2020-01-01T00:00:00.000Z",
            confirmedBy: "someone@example.test",
          }),
        ),
      );

      expect(res.status).to.equal(200);
      expect(h.instance.branding.font.license.confirmedBy).to.equal(ADMIN);
      expect(h.instance.branding.font.license.confirmedAt).to.not.equal(
        "2020-01-01T00:00:00.000Z",
      );
    });

    it("delivers the reference with URL, name and size, and no licence", async function () {
      expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.font).to.deep.equal({
        source: "media",
        reference: {
          source: "media",
          mediaId: FONT_ID,
          url: `/api/v2/instance/media/${FONT_ID}/file`,
          name: "House Sans",
          size: 48213,
        },
      });
    });

    it("keeps the licence out of the public instance", async function () {
      expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);

      const res = await h.api().get("/api/instances/public");

      expect(res.status).to.equal(200);
      expect(res.body.branding.font).to.deep.equal({
        source: "media",
        reference: { source: "media", mediaId: FONT_ID },
      });
    });

    it("shows the licence to the instance owner", async function () {
      expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);

      const res = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.branding.font.license.confirmedBy).to.equal(ADMIN);
    });

    describe("the confirmation of the licence", function () {
      it("is required for a new font", async function () {
        const before = clone(h.instance);

        for (const font of [
          { source: "media", reference: { source: "media", mediaId: FONT_ID } },
          ownFont(FONT_ID, null),
          ownFont(FONT_ID, {}),
          ownFont(FONT_ID, { confirmed: false }),
          ownFont(FONT_ID, { confirmed: "true" }),
        ]) {
          const res = await save(branded(font));

          expect(res.status).to.equal(400);
          expect(res.body.details).to.deep.equal([
            { field: "branding.font.license", code: "required" },
          ]);
          expect(h.instance).to.deep.equal(before);
        }
      });

      it("is kept while the same font is saved again, also without the tick", async function () {
        expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
        const confirmed = clone(h.instance.branding.font.license);

        // As the form sends it back after a reload: the stored licence, no tick.
        const res = await save(
          branded(ownFont(FONT_ID, confirmed), { header: "neutral" }),
        );

        expect(res.status).to.equal(200);
        expect(h.instance.branding.font.license).to.deep.equal(confirmed);
      });

      it("is kept for the same font without a licence or with the tick again", async function () {
        expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
        const confirmed = clone(h.instance.branding.font.license);

        for (const font of [
          { source: "media", reference: { source: "media", mediaId: FONT_ID } },
          ownFont(FONT_ID, { confirmed: true }),
        ]) {
          const res = await save(branded(font));

          expect(res.status).to.equal(200);
          expect(h.instance.branding.font.license).to.deep.equal(confirmed);
        }
      });

      it("is withdrawn by an untick, also for the same font", async function () {
        expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
        const before = clone(h.instance);

        const res = await save(branded(ownFont(FONT_ID, { confirmed: false })));

        expect(res.status).to.equal(400);
        expect(res.body.details).to.deep.equal([
          { field: "branding.font.license", code: "required" },
        ]);
        expect(h.instance).to.deep.equal(before);
      });

      it("no longer holds once the font changes", async function () {
        expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
        const confirmed = clone(h.instance.branding.font.license);

        const refused = await save(branded(ownFont(OTHER_FONT_ID, confirmed)));

        expect(refused.status).to.equal(400);
        expect(refused.body.details).to.deep.equal([
          { field: "branding.font.license", code: "required" },
        ]);
        expect(h.instance.branding.font.reference.mediaId).to.equal(FONT_ID);

        const res = await save(branded(ownFont(OTHER_FONT_ID)));
        expect(res.status).to.equal(200);
        expect(h.instance.branding.font.reference.mediaId).to.equal(
          OTHER_FONT_ID,
        );
      });

      it("no longer holds once a curated font stood in between", async function () {
        expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
        const confirmed = clone(h.instance.branding.font.license);
        expect((await save(branded(curated("inter")))).status).to.equal(200);

        const res = await save(branded(ownFont(FONT_ID, confirmed)));

        expect(res.status).to.equal(400);
      });
    });

    it("refuses an intern medium", async function () {
      const before = clone(h.instance);

      const res = await save(branded(ownFont(INTERN_FONT_ID)));

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("media_reference_not_public");
      expect(h.instance).to.deep.equal(before);
    });

    it("refuses an image", async function () {
      const before = clone(h.instance);

      const res = await save(branded(ownFont(IMAGE_ID)));

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("media_reference_wrong_kind");
      expect(res.body.params).to.deep.equal({
        mediaId: IMAGE_ID,
        kind: "font",
      });
      expect(h.instance).to.deep.equal(before);
    });

    it("refuses a medium the library does not hold", async function () {
      const res = await save(branded(ownFont("gone")));

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("media_reference_unknown");
    });
  });

  describe("refusing a malformed font", function () {
    for (const [name, font, details] of [
      [
        "a font that is no object",
        "inter",
        [
          {
            field: "branding.font",
            code: "invalid_format",
            params: { format: "object" },
          },
        ],
      ],
      [
        "an unknown source",
        { source: "google", id: "inter" },
        [
          {
            field: "branding.font.source",
            code: "invalid_enum",
            params: { allowed: ["curated", "media"] },
          },
        ],
      ],
      [
        "a curated font without id",
        { source: "curated" },
        [{ field: "branding.font.id", code: "required" }],
      ],
      [
        "a font of the library without reference",
        { source: "media", license: { confirmed: true } },
        [{ field: "branding.font.reference", code: "required" }],
      ],
      [
        "an external address as reference",
        {
          source: "media",
          reference: {
            source: "external",
            url: "https://fonts.example/a.woff2",
          },
          license: { confirmed: true },
        },
        [
          {
            field: "branding.font.reference.source",
            code: "invalid_enum",
            params: { allowed: ["media"] },
          },
        ],
      ],
      [
        "a reference without media id",
        {
          source: "media",
          reference: { source: "media" },
          license: { confirmed: true },
        },
        [{ field: "branding.font.reference.mediaId", code: "required" }],
      ],
    ]) {
      it(`refuses ${name} with 400`, async function () {
        const res = await save(branded(font));

        expect(res.status).to.equal(400);
        expect(res.body.details).to.deep.equal(details);
      });
    }
  });

  describe("the Theme Bundle", function () {
    it("delivers no font while the branding is switched off, and keeps the stored one", async function () {
      const res = await save(branded(ownFont(FONT_ID), { active: false }));
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.font).to.equal(null);
      expect(h.instance.branding.font.reference.mediaId).to.equal(FONT_ID);
    });

    for (const [name, from, to] of [
      ["from the system font to a curated one", null, curated("inter")],
      ["between two curated fonts", curated("inter"), curated("roboto")],
      [
        "from a curated font to one of the library",
        curated("inter"),
        ownFont(FONT_ID),
      ],
      [
        "between two fonts of the library",
        ownFont(FONT_ID),
        ownFont(OTHER_FONT_ID),
      ],
    ]) {
      it(`changes its ETag ${name}`, async function () {
        expect((await save(branded(from))).status).to.equal(200);
        const before = await themeBundle();

        expect((await save(branded(to))).status).to.equal(200);
        const after = await themeBundle();

        expect(after.headers.etag).to.match(/^"[0-9a-f]{16}"$/);
        expect(after.headers.etag).to.not.equal(before.headers.etag);
      });
    }
  });

  describe("deleting a font", function () {
    const remove = (mediaId) =>
      h.api().delete(`/api/v2/instance/media/${mediaId}`).set(h.as(ADMIN));

    it("answers 409 media_in_use while the branding uses it", async function () {
      expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);

      const res = await remove(FONT_ID);

      // The body of `media_in_use` is the usage proof alone.
      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal([
        { type: "instance", id: null, title: "instance" },
      ]);
      expect(MediaService.deleteMedia.called).to.equal(false);
    });

    it("deletes a font no branding uses", async function () {
      expect((await save(branded(ownFont(FONT_ID)))).status).to.equal(200);
      MediaService.deleteMedia.resetHistory();

      const res = await remove(OTHER_FONT_ID);

      expect(res.status).to.equal(204);
      expect(MediaService.deleteMedia.calledOnce).to.equal(true);
    });
  });
});
