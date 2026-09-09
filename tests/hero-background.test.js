/**
 * The Background on the instance branding (hero-layout ticket 05): what the
 * normaliser stores, which JSON path and code it refuses on, which media a
 * Background may point at, what a branding save does to a Background it does
 * not mention, and what the Theme Bundle carries.
 *
 * No database: the media lookups run over a stubbed MediaManager, the
 * instance write over a stubbed model.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  COLOR_BACKGROUND,
  IMAGE_BACKGROUND,
  IMAGE_MEDIA_ID,
  INVALID_BACKGROUNDS,
  VARIANT_BACKGROUND,
} = require("./fixtures/hero-layout/backgrounds");
const {
  DEFAULT_BACKGROUND,
  normalizeBackground,
} = require("../src/commons/services/hero-layout/hero-layout-schema");
const {
  exportBackground,
} = require("../src/commons/services/hero-layout/hero-export");
const MediaManager = require("../src/commons/data-managers/media-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const CatalogService = require("../src/commons/services/catalog-service");
const { Media } = require("../src/commons/entities/media/media");
const { ValidationError } = require("../src/errors/ValidationError");

/**
 * A stored instance medium, public image by default.
 */
function instanceImage(overrides = {}) {
  return new Media({
    id: IMAGE_MEDIA_ID,
    tenantId: null,
    kind: "image",
    visibility: "public",
    mimeType: "image/jpeg",
    size: 1000,
    originalFileName: "hero.jpg",
    width: 1920,
    height: 1080,
    ...overrides,
  });
}

/**
 * Answers `getMedia(id, null)` with the medium, and every other lookup with
 * nothing — a tenant medium is invisible to the instance scope.
 */
function stubInstanceMedia(media) {
  sinon
    .stub(MediaManager, "getMedia")
    .callsFake(async (mediaId, tenantId) =>
      mediaId === IMAGE_MEDIA_ID && tenantId == null ? media : null,
    );
}

/**
 * Runs the normaliser and hands back the details it refused with.
 */
async function refusalOf(input, field = "background") {
  try {
    await normalizeBackground(input, field);
  } catch (error) {
    expect(error).to.be.instanceOf(ValidationError);
    return error.errors;
  }

  throw new Error("the Background was accepted");
}

describe("Background normalisation", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("round-trips the three Backgrounds of the Shared contract unchanged", async function () {
    stubInstanceMedia(instanceImage());

    expect(await normalizeBackground(VARIANT_BACKGROUND)).to.deep.equal(
      VARIANT_BACKGROUND,
    );
    expect(await normalizeBackground(COLOR_BACKGROUND)).to.deep.equal(
      COLOR_BACKGROUND,
    );
    expect(await normalizeBackground(IMAGE_BACKGROUND)).to.deep.equal(
      IMAGE_BACKGROUND,
    );
  });

  it("fills the defaults of a variant Background", async function () {
    const stored = await normalizeBackground({
      version: 1,
      type: "variant",
      variant: "grid",
    });

    expect(stored).to.deep.equal({
      version: 1,
      type: "variant",
      variant: "grid",
      orbs: true,
      noise: true,
      intensity: "normal",
    });
  });

  it("leaves the dark colour out when it is not given", async function () {
    const stored = await normalizeBackground({
      version: 1,
      type: "color",
      light: "#f3f4f6",
    });

    expect(stored).to.deep.equal({
      version: 1,
      type: "color",
      light: "#f3f4f6",
    });
    expect(stored).to.not.have.property("dark");
  });

  it("removes the dark colour when it is cleared", async function () {
    const stored = await normalizeBackground({
      ...COLOR_BACKGROUND,
      dark: null,
    });

    expect(stored).to.not.have.property("dark");
  });

  it("fills focal point and overlay of an image Background", async function () {
    stubInstanceMedia(instanceImage());

    const stored = await normalizeBackground({
      version: 1,
      type: "image",
      image: { source: "media", mediaId: IMAGE_MEDIA_ID },
    });

    expect(stored).to.deep.equal({
      version: 1,
      type: "image",
      image: { source: "media", mediaId: IMAGE_MEDIA_ID },
      focalPoint: { x: 50, y: 50 },
      overlay: { light: { color: "#000000", opacity: 40 } },
    });
  });

  it("keeps an overlay that names only its light entry", async function () {
    stubInstanceMedia(instanceImage());

    const stored = await normalizeBackground({
      ...IMAGE_BACKGROUND,
      overlay: { light: { color: "#112233", opacity: 10 } },
    });

    expect(stored.overlay).to.deep.equal({
      light: { color: "#112233", opacity: 10 },
    });
  });

  it("strips the derived keys of an enriched media reference", async function () {
    stubInstanceMedia(instanceImage());

    const stored = await normalizeBackground({
      ...IMAGE_BACKGROUND,
      image: {
        source: "media",
        mediaId: IMAGE_MEDIA_ID,
        url: `/api/v2/instance/media/${IMAGE_MEDIA_ID}/file`,
        width: 1920,
        height: 1080,
      },
    });

    expect(stored.image).to.deep.equal({
      source: "media",
      mediaId: IMAGE_MEDIA_ID,
    });
  });

  it("normalises what it already normalised", async function () {
    stubInstanceMedia(instanceImage());

    const once = await normalizeBackground(IMAGE_BACKGROUND);
    const twice = await normalizeBackground(once);

    expect(twice).to.deep.equal(once);
  });

  it("reads a cleared key as one that is not given", async function () {
    stubInstanceMedia(instanceImage());

    // null and "" are how the editor clears a field, so they fall back to the
    // default rather than count as a fault.
    const variant = await normalizeBackground({
      ...VARIANT_BACKGROUND,
      orbs: null,
      intensity: "",
    });
    const image = await normalizeBackground({
      ...IMAGE_BACKGROUND,
      focalPoint: null,
      overlay: null,
    });

    expect(variant.orbs).to.equal(true);
    expect(variant.intensity).to.equal("normal");
    expect(image.focalPoint).to.deep.equal({ x: 50, y: 50 });
    expect(image.overlay).to.deep.equal({
      light: { color: "#000000", opacity: 40 },
    });
  });

  it("reads null as the reset to the default Background", async function () {
    expect(await normalizeBackground(null)).to.equal(null);
    expect(DEFAULT_BACKGROUND).to.deep.equal(VARIANT_BACKGROUND);
  });

  INVALID_BACKGROUNDS.forEach(function (fixture) {
    it(`refuses ${fixture.name}`, async function () {
      stubInstanceMedia(instanceImage());

      const details = await refusalOf(fixture.input);

      expect(details.map(({ field, code }) => ({ field, code }))).to.deep.equal(
        fixture.expected,
      );
    });
  });

  it("writes the path of the request body it was given", async function () {
    const details = await refusalOf(
      { version: 1, type: "color", light: "#fff" },
      "branding.background",
    );

    expect(details[0].field).to.equal("branding.background.light");
  });

  it("refuses something that is not an object at all", async function () {
    const details = await refusalOf("poly");

    expect(details).to.deep.equal([
      {
        field: "background",
        code: "invalid_format",
        params: { format: "object" },
      },
    ]);
  });
});

describe("the media a Background may point at", function () {
  afterEach(function () {
    sinon.restore();
  });

  async function reasonFor(media) {
    stubInstanceMedia(media);
    const details = await refusalOf(IMAGE_BACKGROUND);

    expect(details).to.have.length(1);
    expect(details[0].field).to.equal("background.image");
    expect(details[0].code).to.equal("invalid_custom");
    return details[0].params.reason;
  }

  it("takes a public instance image", async function () {
    stubInstanceMedia(instanceImage());

    expect(await normalizeBackground(IMAGE_BACKGROUND)).to.deep.equal(
      IMAGE_BACKGROUND,
    );
  });

  it("refuses an external reference", async function () {
    stubInstanceMedia(instanceImage());

    const details = await refusalOf({
      ...IMAGE_BACKGROUND,
      image: { source: "external", url: "https://example.org/hero.jpg" },
    });

    expect(details[0].params.reason).to.equal("external");
  });

  it("refuses a medium the instance scope does not know", async function () {
    expect(await reasonFor(null)).to.equal("not_instance");
  });

  it("refuses an intern medium", async function () {
    expect(await reasonFor(instanceImage({ visibility: "intern" }))).to.equal(
      "not_public",
    );
  });

  it("refuses a document", async function () {
    expect(
      await reasonFor(
        instanceImage({ kind: "document", mimeType: "application/pdf" }),
      ),
    ).to.equal("not_image");
  });

  it("looks the medium up in the instance scope, never in a tenant", async function () {
    const getMedia = sinon.stub(MediaManager, "getMedia").resolves(null);

    await refusalOf(IMAGE_BACKGROUND);

    expect(getMedia.calledOnceWith(IMAGE_MEDIA_ID, null)).to.equal(true);
  });
});

describe("the exported Background", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("is the default when nothing is stored", async function () {
    expect(await exportBackground(null)).to.deep.equal(VARIANT_BACKGROUND);
    expect(await exportBackground(undefined)).to.deep.equal(VARIANT_BACKGROUND);
  });

  it("passes a variant and a colour Background through", async function () {
    expect(await exportBackground(COLOR_BACKGROUND)).to.deep.equal(
      COLOR_BACKGROUND,
    );
  });

  it("enriches the image with its URL and the dimensions of the original", async function () {
    stubInstanceMedia(instanceImage());

    const exported = await exportBackground(IMAGE_BACKGROUND);

    expect(exported.image).to.deep.equal({
      source: "media",
      mediaId: IMAGE_MEDIA_ID,
      url: `/api/v2/instance/media/${IMAGE_MEDIA_ID}/file`,
      width: 1920,
      height: 1080,
    });
  });

  it("answers null dimensions while the medium is not backfilled", async function () {
    stubInstanceMedia(instanceImage({ width: null, height: null }));

    const exported = await exportBackground(IMAGE_BACKGROUND);

    expect(exported.image.width).to.equal(null);
    expect(exported.image.height).to.equal(null);
  });

  it("keeps the reference of a missing medium instead of falling back", async function () {
    sinon.stub(MediaManager, "getMedia").resolves(null);

    const exported = await exportBackground(IMAGE_BACKGROUND);

    expect(exported.type).to.equal("image");
    expect(exported.image).to.deep.equal({
      source: "media",
      mediaId: IMAGE_MEDIA_ID,
      url: `/api/v2/instance/media/${IMAGE_MEDIA_ID}/file`,
      width: null,
      height: null,
    });
  });
});

describe("a branding save and its Background", function () {
  let stored;
  let written;

  beforeEach(function () {
    stored = {
      branding: { active: true, background: { ...COLOR_BACKGROUND } },
    };
    written = null;

    const raw = {
      ...stored,
      bookableCustomFields: [],
      toEntity: () => ({ bookableCustomFields: [] }),
    };

    sinon.stub(InstanceModel, "findOne").resolves(raw);
    sinon
      .stub(InstanceModel, "findOneAndUpdate")
      .callsFake(async (filter, update) => {
        written = update.$set;
        return raw;
      });
  });

  afterEach(function () {
    sinon.restore();
  });

  it("keeps the stored Background when the payload does not mention it", async function () {
    await InstanceManager.updateInstance({ branding: { active: true } });

    expect(written.branding.background).to.deep.equal(COLOR_BACKGROUND);
  });

  it("keeps the stored Background when the payload carries no branding", async function () {
    await InstanceManager.updateInstance({});

    expect(written.branding.background).to.deep.equal(COLOR_BACKGROUND);
  });

  it("resets to the default when the payload says null", async function () {
    await InstanceManager.updateInstance({
      branding: { active: true, background: null },
    });

    expect(written.branding.background).to.equal(null);
  });

  it("normalises the Background it is given", async function () {
    await InstanceManager.updateInstance({
      branding: {
        active: true,
        background: { version: 1, type: "variant", variant: "mesh" },
      },
    });

    expect(written.branding.background).to.deep.equal({
      version: 1,
      type: "variant",
      variant: "mesh",
      orbs: true,
      noise: true,
      intensity: "normal",
    });
  });

  it("refuses an invalid Background at its path in the instance body", async function () {
    let refused;
    try {
      await InstanceManager.updateInstance({
        branding: { active: true, background: { version: 1, type: "color" } },
      });
    } catch (error) {
      refused = error;
    }

    expect(refused).to.be.instanceOf(ValidationError);
    expect(refused.errors[0].field).to.equal("branding.background.light");
    expect(written).to.equal(null);
  });
});

describe("the Theme Bundle carries a Background", function () {
  afterEach(function () {
    sinon.restore();
  });

  function stubBundle(branding) {
    sinon.stub(CatalogManager, "getInstanceCatalog").resolves({
      name: "Portal",
      visibility: "public",
    });
    sinon.stub(InstanceManager, "getBranding").resolves(branding);
  }

  it("answers the default on a fresh instance", async function () {
    stubBundle({ active: true, theme: null, logoUrl: "", faviconUrl: "" });

    const bundle = await CatalogService.getTheme();

    expect(bundle.background).to.deep.equal(VARIANT_BACKGROUND);
  });

  it("answers the stored Background with its image enriched", async function () {
    stubInstanceMedia(instanceImage());
    stubBundle({ active: true, background: IMAGE_BACKGROUND });

    const bundle = await CatalogService.getTheme();

    expect(bundle.background.image.url).to.equal(
      `/api/v2/instance/media/${IMAGE_MEDIA_ID}/file`,
    );
    expect(bundle.background.image.width).to.equal(1920);
  });

  it("falls back to the default while the branding is inactive", async function () {
    stubBundle({ active: false, background: COLOR_BACKGROUND });

    const bundle = await CatalogService.getTheme();

    expect(bundle.background).to.deep.equal(VARIANT_BACKGROUND);
  });

  it("carries the Background on a slug bundle too", async function () {
    sinon
      .stub(CatalogManager, "getCatalogBySlug")
      .resolves({ name: "Town hall", visibility: "public" });
    sinon
      .stub(InstanceManager, "getBranding")
      .resolves({ active: true, background: COLOR_BACKGROUND });

    const bundle = await CatalogService.getThemeBySlug("town-hall");

    expect(bundle.background).to.deep.equal(COLOR_BACKGROUND);
  });
});
