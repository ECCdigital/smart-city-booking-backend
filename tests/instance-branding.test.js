/**
 * The appearance of the portal in `Instance.branding` (ECCdigital/tickets#520,
 * map #510): the accent colour, the header and the logo size of the sign-in
 * pages. `PUT /api/instances` checks and stores them, the Theme Bundle
 * delivers them under `branding.active`, and an instance that never stored
 * them reads their defaults. The real manager runs behind the routes, over a
 * model that keeps the stored instance of the harness.
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
const Instance = require("../src/commons/entities/instance/instance");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

describe("Appearance in the instance branding", function () {
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
    it("delivers the stored accent, header and logo size in the Theme Bundle", async function () {
      const res = await save(
        branded({
          theme: {
            colors: {
              primary: "#123456",
              secondary: "#654321",
              accent: "#f59e0b",
            },
          },
          header: "secondary",
          authLogoSize: "lg",
        }),
      );
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.theme.colors).to.deep.equal({
        primary: "#123456",
        secondary: "#654321",
        accent: "#f59e0b",
      });
      expect(bundle.body.header).to.equal("secondary");
      expect(bundle.body.authLogoSize).to.equal("lg");
    });

    it("delivers the defaults while the branding is switched off, and keeps the stored values", async function () {
      const res = await save(
        branded({
          active: false,
          theme: {
            colors: {
              primary: "#123456",
              secondary: "#654321",
              accent: "#f59e0b",
            },
          },
          header: "neutral",
          authLogoSize: "md",
        }),
      );
      expect(res.status).to.equal(200);

      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body).to.include({
        active: false,
        theme: null,
        header: "primary",
        authLogoSize: "sm",
      });

      const instance = await h.api().get("/api/instances").set(h.as(ADMIN));
      expect(instance.body.branding).to.include({
        active: false,
        header: "neutral",
        authLogoSize: "md",
      });
      expect(instance.body.branding.theme.colors.accent).to.equal("#f59e0b");
    });
  });

  describe("the ETag of the Theme Bundle", function () {
    const base = () =>
      branded({
        theme: {
          colors: { primary: "#123456", secondary: "#654321", accent: "" },
        },
        header: "primary",
        authLogoSize: "sm",
      });

    for (const [name, change] of [
      [
        "the accent",
        (branding) => {
          branding.theme.colors.accent = "#f59e0b";
        },
      ],
      [
        "the header",
        (branding) => {
          branding.header = "neutral";
        },
      ],
      [
        "the logo size",
        (branding) => {
          branding.authLogoSize = "md";
        },
      ],
    ]) {
      it(`changes with ${name}`, async function () {
        expect((await save(base())).status).to.equal(200);
        const before = await themeBundle();

        const changed = base();
        change(changed);
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
    const colorsWith = (accent) => ({
      theme: { colors: { primary: "#123456", secondary: "#654321", accent } },
    });

    for (const [name, overrides, detail] of [
      [
        "an accent in short form",
        colorsWith("#fff"),
        {
          field: "branding.theme.colors.accent",
          code: "invalid_format",
          params: { format: "color" },
        },
      ],
      [
        "an accent with alpha",
        colorsWith("#f59e0b80"),
        {
          field: "branding.theme.colors.accent",
          code: "invalid_format",
          params: { format: "color" },
        },
      ],
      [
        "an accent as a colour name",
        colorsWith("amber"),
        {
          field: "branding.theme.colors.accent",
          code: "invalid_format",
          params: { format: "color" },
        },
      ],
      [
        "an accent that is no string",
        colorsWith(null),
        {
          field: "branding.theme.colors.accent",
          code: "invalid_format",
          params: { format: "color" },
        },
      ],
      [
        "an unknown header",
        { header: "dark" },
        {
          field: "branding.header",
          code: "invalid_enum",
          params: { allowed: ["neutral", "primary", "secondary"] },
        },
      ],
      [
        "an unknown logo size",
        { authLogoSize: "xl" },
        {
          field: "branding.authLogoSize",
          code: "invalid_enum",
          params: { allowed: ["sm", "md", "lg"] },
        },
      ],
    ]) {
      it(`refuses ${name} with 400 and keeps the instance`, async function () {
        const before = clone(h.instance);

        const res = await save(branded(overrides));

        expect(res.status).to.equal(400);
        expect(res.body.details).to.deep.equal([detail]);
        expect(h.instance).to.deep.equal(before);
      });
    }

    it("names every fault of one save", async function () {
      const res = await save(
        branded({
          ...colorsWith("#12345"),
          header: "Primary",
          authLogoSize: "",
        }),
      );

      expect(res.status).to.equal(400);
      expect(res.body.details.map((detail) => detail.field)).to.deep.equal([
        "branding.theme.colors.accent",
        "branding.header",
        "branding.authLogoSize",
      ]);
    });

    it("takes an empty accent and an accent in capitals", async function () {
      for (const accent of ["", "#F59E0B"]) {
        const res = await save(branded(colorsWith(accent)));

        expect(res.status).to.equal(200);
        expect(h.instance.branding.theme.colors.accent).to.equal(accent);
      }
    });
  });

  describe("an instance stored before the fields", function () {
    beforeEach(function () {
      // As the database holds it: branded, without any of the three fields.
      h.instance.branding = {
        active: true,
        theme: { colors: { primary: "#123456", secondary: "#654321" } },
        logo: null,
        favicon: null,
        logoUrl: "",
        faviconUrl: "",
      };
    });

    it("delivers the defaults in the Theme Bundle", async function () {
      const bundle = await themeBundle();

      expect(bundle.status).to.equal(200);
      expect(bundle.body.theme.colors).to.deep.equal({
        primary: "#123456",
        secondary: "#654321",
        accent: "",
      });
      expect(bundle.body.header).to.equal("primary");
      expect(bundle.body.authLogoSize).to.equal("sm");
    });

    it("reads the defaults in the instance", async function () {
      const res = await h.api().get("/api/instances").set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.branding).to.include({
        active: true,
        header: "primary",
        authLogoSize: "sm",
      });
      expect(res.body.branding.theme.colors).to.deep.equal({
        primary: "#123456",
        secondary: "#654321",
        accent: "",
      });
    });
  });
});
