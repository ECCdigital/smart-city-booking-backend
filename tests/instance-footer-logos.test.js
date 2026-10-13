/**
 * The footer logos of the portal in `Instance.branding.footerLogos`
 * (ECCdigital/tickets#523, map #510): a sorted list of logos, each with its
 * size, an optional link and an optional variant for the dark mode.
 * `PUT /api/instances` checks and stores them, the Theme Bundle delivers them
 * under `branding.active`, and a medium that carries one cannot be deleted.
 * The real manager runs behind the routes, over a model that keeps the stored
 * instance of the harness.
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
const Instance = require("../src/commons/entities/instance/instance");
const { Media } = require("../src/commons/entities/media/media");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

// The instance media the footer logos pick from, beside the fixture medium of
// the route world.
const FUNDING = "footer-funding";
const CITY = "footer-city";
const CITY_DARK = "footer-city-dark";
const INTERN = "footer-intern";
const DOCUMENT = "footer-document";

const instanceMedium = (id, overrides = {}) =>
  new Media({
    id,
    tenantId: null,
    kind: "image",
    mimeType: "image/png",
    size: 7,
    originalFileName: `${id}.png`,
    title: "",
    uploadedBy: ADMIN,
    visibility: "public",
    storage: { provider: "s3", key: id },
    ...overrides,
  });

const MEDIA = [
  instanceMedium(FUNDING, {
    title: "Gefördert vom BMWSB",
    width: 400,
    height: 300,
  }),
  instanceMedium(CITY, { width: 200, height: 80 }),
  instanceMedium(CITY_DARK, { title: "Stadt dunkel", width: 200, height: 80 }),
  instanceMedium(INTERN, { visibility: "intern" }),
  instanceMedium(DOCUMENT, {
    kind: "document",
    mimeType: "application/pdf",
    originalFileName: "satzung.pdf",
  }),
];

const media = (mediaId) => ({ source: "media", mediaId });

describe("Footer logos in the instance branding", function () {
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

    for (const medium of MEDIA) {
      MediaManager.getMedia.withArgs(medium.id).resolves(medium);
    }

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
    ...overrides,
  });

  describe("saving and delivering", function () {
    it("delivers the stored logos in their order, references enriched", async function () {
      const res = await save(
        branded({
          footerLogos: [
            {
              image: media(FUNDING),
              size: "lg",
              link: "https://www.bmwsb.bund.de/",
              imageDark: null,
            },
            {
              image: media(CITY),
              size: "sm",
              link: "",
              imageDark: media(CITY_DARK),
            },
          ],
        }),
      );
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.footerLogos).to.deep.equal([
        {
          image: {
            source: "media",
            mediaId: FUNDING,
            url: `/api/v2/instance/media/${FUNDING}/file`,
            width: 400,
            height: 300,
            name: "Gefördert vom BMWSB",
          },
          size: "lg",
          link: "https://www.bmwsb.bund.de/",
          imageDark: null,
        },
        {
          image: {
            source: "media",
            mediaId: CITY,
            url: `/api/v2/instance/media/${CITY}/file`,
            width: 200,
            height: 80,
            name: `${CITY}.png`,
          },
          size: "sm",
          link: "",
          imageDark: {
            source: "media",
            mediaId: CITY_DARK,
            url: `/api/v2/instance/media/${CITY_DARK}/file`,
            width: 200,
            height: 80,
            name: "Stadt dunkel",
          },
        },
      ]);
    });

    it("stores a logo that names only its image with the defaults, and drops the derived keys", async function () {
      const res = await save(
        branded({
          footerLogos: [
            {
              image: {
                ...media(FUNDING),
                url: "/stale",
                width: 1,
                height: 1,
                name: "x",
              },
            },
          ],
        }),
      );
      expect(res.status).to.equal(200);

      expect(h.instance.branding.footerLogos).to.deep.equal([
        { image: media(FUNDING), size: "md", link: "", imageDark: null },
      ]);
    });

    it("delivers no logos while the branding is switched off, and keeps the stored ones", async function () {
      const logos = [
        {
          image: media(FUNDING),
          size: "lg",
          link: "https://www.bmwsb.bund.de/",
          imageDark: media(CITY_DARK),
        },
      ];
      const res = await save(branded({ active: false, footerLogos: logos }));
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.active).to.equal(false);
      expect(bundle.body.footerLogos).to.deep.equal([]);

      const instance = await h.api().get("/api/instances").set(h.as(ADMIN));
      expect(instance.body.branding.footerLogos).to.deep.equal(logos);
    });
  });

  describe("the ETag of the Theme Bundle", function () {
    const base = () =>
      branded({
        footerLogos: [
          { image: media(FUNDING), size: "md", link: "", imageDark: null },
          { image: media(CITY), size: "md", link: "", imageDark: null },
        ],
      });

    for (const [name, change] of [
      ["a logo added", (logos) => logos.push({ image: media(CITY_DARK) })],
      ["a logo removed", (logos) => logos.pop()],
      ["the order", (logos) => logos.reverse()],
      [
        "the size",
        (logos) => {
          logos[0].size = "lg";
        },
      ],
      [
        "the link",
        (logos) => {
          logos[0].link = "https://example.org/";
        },
      ],
      [
        "the variant for the dark mode",
        (logos) => {
          logos[1].imageDark = media(CITY_DARK);
        },
      ],
    ]) {
      it(`changes with ${name}`, async function () {
        expect((await save(base())).status).to.equal(200);
        const before = await themeBundle();

        const changed = base();
        change(changed.footerLogos);
        expect((await save(changed)).status).to.equal(200);
        const after = await themeBundle();

        expect(after.headers.etag).to.match(/^"[0-9a-f]{16}"$/);
        expect(after.headers.etag).to.not.equal(before.headers.etag);
      });
    }

    it("stays while a save changes nothing", async function () {
      expect((await save(base())).status).to.equal(200);
      const before = await themeBundle();

      expect((await save(base())).status).to.equal(200);
      const after = await themeBundle();

      expect(after.headers.etag).to.equal(before.headers.etag);
    });
  });

  describe("refusing on save", function () {
    const logo = (overrides = {}) => ({
      image: media(FUNDING),
      size: "md",
      link: "",
      imageDark: null,
      ...overrides,
    });

    /** Saves the given logos and expects the one refusal named. */
    const refuses = async (footerLogos, detail) => {
      const before = clone(h.instance);

      const res = await save(branded({ footerLogos }));

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([detail]);
      expect(h.instance).to.deep.equal(before);
    };

    for (const link of [
      "javascript:alert(1)",
      "JavaScript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.org/logo",
      "mailto:info@example.org",
      "//example.org/",
      "/foerderung",
      "www.example.org",
      "https://",
    ]) {
      it(`refuses the link ${link}`, async function () {
        await refuses([logo(), logo({ link })], {
          field: "branding.footerLogos[1].link",
          code: "invalid_format",
          params: { format: "url" },
        });
      });
    }

    it("refuses a link that is no string", async function () {
      await refuses([logo({ link: 42 })], {
        field: "branding.footerLogos[0].link",
        code: "invalid_format",
        params: { format: "url" },
      });
    });

    it("refuses 13 logos", async function () {
      await refuses(
        Array.from({ length: 13 }, () => logo()),
        {
          field: "branding.footerLogos",
          code: "max_items",
          params: { max: 12, actual: 13 },
        },
      );
    });

    it("takes 12 logos", async function () {
      const res = await save(
        branded({ footerLogos: Array.from({ length: 12 }, () => logo()) }),
      );

      expect(res.status).to.equal(200);
      expect(h.instance.branding.footerLogos).to.have.length(12);
    });

    it("refuses a list that is no array", async function () {
      await refuses(
        { image: media(FUNDING) },
        {
          field: "branding.footerLogos",
          code: "invalid_format",
          params: { format: "array" },
        },
      );
    });

    it("refuses a logo that is no object", async function () {
      await refuses([logo(), "logo.png"], {
        field: "branding.footerLogos[1]",
        code: "invalid_format",
        params: { format: "object" },
      });
    });

    for (const image of [undefined, null]) {
      it(`refuses a logo whose image is ${image}`, async function () {
        await refuses([logo({ image })], {
          field: "branding.footerLogos[0].image",
          code: "required",
        });
      });
    }

    it("refuses an image that is no object", async function () {
      await refuses([logo({ image: "https://example.org/logo.png" })], {
        field: "branding.footerLogos[0].image",
        code: "invalid_format",
        params: { format: "object" },
      });
    });

    it("refuses an image from outside the media library", async function () {
      await refuses(
        [logo({ image: { source: "external", url: "https://x.test/a.png" } })],
        {
          field: "branding.footerLogos[0].image.source",
          code: "invalid_enum",
          params: { allowed: ["media"] },
        },
      );
    });

    it("refuses an image without a media id", async function () {
      await refuses([logo({ imageDark: { source: "media", mediaId: "" } })], {
        field: "branding.footerLogos[0].imageDark.mediaId",
        code: "required",
      });
    });

    it("refuses an unknown size", async function () {
      await refuses([logo({ size: "xl" })], {
        field: "branding.footerLogos[0].size",
        code: "invalid_enum",
        params: { allowed: ["sm", "md", "lg"] },
      });
    });

    // A field left out reads as its default, as above; null is no value of
    // either list, as for `header`.
    it("refuses a size of null", async function () {
      await refuses([logo({ size: null })], {
        field: "branding.footerLogos[0].size",
        code: "invalid_enum",
        params: { allowed: ["sm", "md", "lg"] },
      });
    });

    it("refuses a link of null", async function () {
      await refuses([logo({ link: null })], {
        field: "branding.footerLogos[0].link",
        code: "invalid_format",
        params: { format: "url" },
      });
    });

    it("names every fault of one save", async function () {
      const res = await save(
        branded({
          footerLogos: [
            logo({ size: "XL", link: "javascript:void(0)" }),
            logo({ image: null }),
          ],
        }),
      );

      expect(res.status).to.equal(400);
      expect(res.body.details.map((detail) => detail.field)).to.deep.equal([
        "branding.footerLogos[0].size",
        "branding.footerLogos[0].link",
        "branding.footerLogos[1].image",
      ]);
    });

    it("takes an empty link and an absolute http or https link", async function () {
      const res = await save(
        branded({
          footerLogos: [
            logo({ link: "" }),
            logo({ link: "http://example.org" }),
            logo({ link: "https://www.bmwsb.bund.de/foerderung?x=1#y" }),
          ],
        }),
      );

      expect(res.status).to.equal(200);
      expect(h.instance.branding.footerLogos.map((l) => l.link)).to.deep.equal([
        "",
        "http://example.org",
        "https://www.bmwsb.bund.de/foerderung?x=1#y",
      ]);
    });

    describe("the media behind a logo", function () {
      for (const [name, key, mediaId, code, params] of [
        [
          "an intern image",
          "image",
          INTERN,
          "media_reference_not_public",
          { mediaId: INTERN },
        ],
        [
          "an intern variant",
          "imageDark",
          INTERN,
          "media_reference_not_public",
          { mediaId: INTERN },
        ],
        [
          "a document as image",
          "image",
          DOCUMENT,
          "media_reference_wrong_kind",
          { mediaId: DOCUMENT, kind: "image" },
        ],
        [
          "a document as variant",
          "imageDark",
          DOCUMENT,
          "media_reference_wrong_kind",
          { mediaId: DOCUMENT, kind: "image" },
        ],
        [
          "an unknown medium",
          "image",
          "gone",
          "media_reference_unknown",
          { mediaId: "gone" },
        ],
      ]) {
        it(`refuses ${name} with 400 and keeps the instance`, async function () {
          const before = clone(h.instance);

          const res = await save(
            branded({ footerLogos: [logo(), logo({ [key]: media(mediaId) })] }),
          );

          expect(res.status).to.equal(400);
          expect(res.body.code).to.equal(code);
          expect(res.body.params).to.deep.equal(params);
          expect(h.instance).to.deep.equal(before);
        });
      }
    });
  });

  describe("deleting a medium in use", function () {
    /**
     * A filter over the stored instance as the database reads it: each
     * dotted path walks into objects, and into every entry of a list.
     */
    const valuesAt = (value, [key, ...rest]) => {
      if (Array.isArray(value)) {
        return value.flatMap((entry) => valuesAt(entry, [key, ...rest]));
      }
      if (key === undefined) return [value];
      if (value === null || typeof value !== "object") return [];
      return valuesAt(value[key], rest);
    };
    const matches = (record, filter) =>
      filter.$or.some((condition) =>
        Object.entries(condition).some(([path, wanted]) =>
          valuesAt(record, path.split(".")).includes(wanted),
        ),
      );

    before(function () {
      // The usage proof searches the stored instance; the route world answers
      // no usage anywhere else.
      InstanceManager.getMediaUsage.restore();
      InstanceManager.getBrandingMediaUsage.restore();
      InstanceModel.findOne
        .withArgs(sinon.match.has("$or"), { _id: 1 })
        .callsFake((filter) => ({
          lean: async () =>
            matches(h.instance, filter) ? { _id: "instance" } : null,
        }));
    });

    const remove = (mediaId) =>
      h.api().delete(`/api/v2/instance/media/${mediaId}`).set(h.as(ADMIN));

    /** `media_in_use`: 409, the body is the usage proof naming the instance. */
    const expectInUse = (res) => {
      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal([
        { type: "instance", id: null, title: "instance" },
      ]);
    };

    it("deletes a medium no footer logo holds", async function () {
      const saved = await save(
        branded({ footerLogos: [{ image: media(FUNDING) }] }),
      );
      expect(saved.status).to.equal(200);

      expect((await remove(CITY)).status).to.equal(204);
    });

    for (const [name, mediaId] of [
      ["the image", FUNDING],
      ["the variant for the dark mode", CITY_DARK],
    ]) {
      it(`answers 409 media_in_use for ${name} of a footer logo`, async function () {
        const saved = await save(
          branded({
            footerLogos: [
              { image: media(CITY) },
              { image: media(FUNDING), imageDark: media(CITY_DARK) },
            ],
          }),
        );
        expect(saved.status).to.equal(200);

        const res = await remove(mediaId);

        expectInUse(res);
      });
    }

    it("refuses to turn the image of a footer logo internal", async function () {
      const saved = await save(
        branded({ footerLogos: [{ image: media(FUNDING) }] }),
      );
      expect(saved.status).to.equal(200);

      const res = await h
        .api()
        .patch(`/api/v2/instance/media/${FUNDING}`)
        .set(h.as(ADMIN))
        .send({ visibility: "intern" });

      expectInUse(res);
    });

    it("keeps the medium in use while the branding is switched off", async function () {
      const saved = await save(
        branded({ active: false, footerLogos: [{ image: media(FUNDING) }] }),
      );
      expect(saved.status).to.equal(200);

      const res = await remove(FUNDING);

      expectInUse(res);
    });
  });

  describe("an instance stored before the field", function () {
    beforeEach(function () {
      // As the database holds it: branded, without footer logos.
      h.instance.branding = {
        active: true,
        theme: { colors: { primary: "#123456", secondary: "#654321" } },
        logo: null,
        favicon: null,
        logoUrl: "",
        faviconUrl: "",
      };
    });

    it("delivers no logos in the Theme Bundle", async function () {
      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.footerLogos).to.deep.equal([]);
    });

    it("reads an empty list in the instance", async function () {
      const res = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.branding.footerLogos).to.deep.equal([]);
    });
  });
});
