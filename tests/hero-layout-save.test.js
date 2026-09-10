/**
 * The Hero Layout validated and saved through the instance catalog
 * (hero-layout ticket 07): what the normaliser stores, which JSON path and
 * code it refuses on, what the rich-text sanitiser does to a Block on its way
 * in, which media a Block may point at, and what the instance catalog PUT
 * makes of `heroLayout`.
 *
 * No database: the media lookups run over a stubbed MediaManager, the catalog
 * reads and writes over stubbed managers, and the routes over the lifecycle
 * harness and the fixture world.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  CROWDED_RICHTEXT_BLOCK,
  FILLED_BLOCK_DEFAULTS,
  GLAS_PANEL,
  INVALID_LAYOUTS,
  LAYOUT_MEDIA_ID,
  MINIMAL_IMAGE_BLOCK,
  MINIMAL_LAYOUT,
  MINIMAL_LAYOUT_STORED,
  MINIMAL_RICHTEXT_BLOCK,
  MINIMAL_TEXT_BLOCK,
  layoutOf,
} = require("./fixtures/hero-layout/layouts");
const {
  ACCEPTANCE_LAYOUT,
} = require("./fixtures/hero-layout/acceptance-layout");
const {
  DEFAULT_HERO_LAYOUT,
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
  normalizeBackground,
  normalizeHeroLayout,
} = require("../src/commons/services/hero-layout/hero-layout-schema");
const {
  defaultHeroLayout,
} = require("../src/commons/services/hero-layout/hero-default-layout");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const CatalogService = require("../src/commons/services/catalog-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const { Media } = require("../src/commons/entities/media/media");
const {
  ThemeExportCache,
} = require("../src/commons/services/catalog/theme-export-cache");
const { ValidationError } = require("../src/errors/ValidationError");

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

/**
 * Answers every instance lookup with what `mediumOf` makes of the id, and
 * every tenant lookup with nothing — a tenant medium is invisible to the
 * instance scope.
 */
function stubMediaLookup(mediumOf) {
  sinon
    .stub(MediaManager, "getMedia")
    .callsFake(async (mediaId, tenantId) =>
      tenantId == null ? mediumOf(mediaId) : null,
    );
}

/** The happy path: every medium the fixtures name is a public image. */
const stubInstanceMedia = () => stubMediaLookup(instanceImage);

/** Runs the normaliser and hands back the details it refused with. */
async function refusalOf(input) {
  try {
    await normalizeHeroLayout(input);
  } catch (error) {
    expect(error).to.be.instanceOf(ValidationError);
    return error.errors;
  }

  throw new Error("the layout was accepted");
}

/** The `field`/`code` pairs of a refusal, without the params. */
const codesOf = (details) =>
  details.map(({ field, code }) => ({ field, code }));

/**
 * A layout in the form it was stored in before the Panel became an object:
 * complete otherwise, the two legacy words where a Panel stands today.
 */
const LEGACY_PANEL_WORDS = ["none", "translucent", "none"];
const LEGACY_LAYOUT = Object.freeze({
  ...MINIMAL_LAYOUT_STORED,
  blocks: MINIMAL_LAYOUT_STORED.blocks.map((block, index) => ({
    ...block,
    panel: LEGACY_PANEL_WORDS[index],
  })),
});

/**
 * A layout in the form it was stored in before a Block had an alignment, an
 * offset, a layer, and a rich text a size of its own: complete otherwise.
 */
const withoutBlockStyling = (layout) => ({
  ...layout,
  blocks: layout.blocks.map((block) => {
    const added = ["align", "offset", "layer"];

    if (block.type === "richtext") {
      added.push("size");
    }

    return Object.fromEntries(
      Object.entries(block).filter(([key]) => !added.includes(key)),
    );
  }),
});

/**
 * The coat of arms of the Shared contract's acceptance fixture: the one Block
 * that carries an alignment, an offset and a layer away from their defaults,
 * and the reason `align` is a common field rather than a text-only one.
 */
const [CREST_BLOCK] = ACCEPTANCE_LAYOUT.blocks;

/** The single Block of a normalised one-Block layout. */
async function blockOf(input) {
  const layout = await normalizeHeroLayout(layoutOf(input));

  return layout.blocks[0];
}

describe("Hero Layout normalisation", function () {
  beforeEach(function () {
    stubInstanceMedia();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("round-trips the Default Hero Layout of the Shared contract unchanged", async function () {
    expect(await normalizeHeroLayout(DEFAULT_HERO_LAYOUT)).to.deep.equal(
      DEFAULT_HERO_LAYOUT,
    );
  });

  it("round-trips the acceptance fixture of the Shared contract unchanged", async function () {
    expect(await normalizeHeroLayout(ACCEPTANCE_LAYOUT)).to.deep.equal(
      ACCEPTANCE_LAYOUT,
    );
  });

  it("round-trips the crowded rich-text Block of the Shared contract unchanged", async function () {
    const layout = layoutOf(CROWDED_RICHTEXT_BLOCK);

    expect((await normalizeHeroLayout(layout)).blocks[0]).to.deep.equal(
      CROWDED_RICHTEXT_BLOCK,
    );
  });

  it("fills every default of a minimal layout", async function () {
    expect(await normalizeHeroLayout(MINIMAL_LAYOUT)).to.deep.equal(
      MINIMAL_LAYOUT_STORED,
    );
  });

  it("fills the common Block defaults for each type", async function () {
    for (const block of [
      MINIMAL_TEXT_BLOCK,
      MINIMAL_RICHTEXT_BLOCK,
      MINIMAL_IMAGE_BLOCK,
    ]) {
      // Deep: the common defaults now carry the offset object.
      expect(await blockOf(block), block.type).to.deep.include(
        FILLED_BLOCK_DEFAULTS,
      );
    }
  });

  it("fills the content defaults of a text Block", async function () {
    expect(await blockOf(MINIMAL_TEXT_BLOCK)).to.include({
      size: "md",
      color: "default",
      weight: "normal",
      shadow: false,
    });
  });

  it("fills the content defaults of a rich-text Block", async function () {
    expect(await blockOf(MINIMAL_RICHTEXT_BLOCK)).to.include({
      size: "md",
      color: "default",
      shadow: false,
    });
  });

  ["xs", "sm", "md", "lg", "xl", "2xl"].forEach(function (size) {
    it(`takes ${size} on a rich-text Block`, async function () {
      // The size a run of words inherits when it carries no class of its own.
      expect(await blockOf({ ...MINIMAL_RICHTEXT_BLOCK, size })).to.include({
        size,
      });
    });
  });

  it("names the six steps a rich-text size is measured against", async function () {
    const details = await refusalOf(
      layoutOf({ ...MINIMAL_RICHTEXT_BLOCK, size: "3xl" }),
    );

    expect(details).to.deep.equal([
      {
        field: "heroLayout.blocks[0].size",
        code: "invalid_enum",
        params: { allowed: ["xs", "sm", "md", "lg", "xl", "2xl"] },
      },
    ]);
  });

  it("keeps the size of a text Block where it was", async function () {
    expect(await blockOf({ ...MINIMAL_TEXT_BLOCK, size: "2xl" })).to.include({
      size: "2xl",
    });
  });

  it("fills the content defaults of an image Block", async function () {
    expect(await blockOf(MINIMAL_IMAGE_BLOCK)).to.include({
      maxHeight: "md",
      invertInDarkMode: false,
    });
  });

  it("keeps an empty layout without Blocks", async function () {
    const layout = await normalizeHeroLayout({ version: 1, blocks: [] });

    expect(layout.blocks).to.deep.equal([]);
  });

  it("takes the twelve Blocks the contract allows", async function () {
    const blocks = Array.from({ length: 12 }, (_, index) => ({
      ...MINIMAL_TEXT_BLOCK,
      id: `t${index}`,
    }));

    expect(
      (await normalizeHeroLayout(layoutOf(...blocks))).blocks,
    ).to.have.length(12);
  });

  it("keeps the Blocks in the order they were sent", async function () {
    const layout = await normalizeHeroLayout(
      layoutOf(MINIMAL_IMAGE_BLOCK, MINIMAL_TEXT_BLOCK, MINIMAL_RICHTEXT_BLOCK),
    );

    expect(layout.blocks.map((block) => block.id)).to.deep.equal([
      "i1",
      "t1",
      "r1",
    ]);
  });

  it("drops an empty English text and keeps the German", async function () {
    const block = await blockOf({
      ...MINIMAL_TEXT_BLOCK,
      text: { de: "Hallo", en: "" },
    });

    expect(block.text).to.deep.equal({ de: "Hallo" });
  });

  it("strips the derived keys of an enriched image reference", async function () {
    const block = await blockOf({
      ...MINIMAL_IMAGE_BLOCK,
      image: {
        source: "media",
        mediaId: LAYOUT_MEDIA_ID,
        url: `/api/v2/instance/media/${LAYOUT_MEDIA_ID}/file`,
        width: 1200,
        height: 800,
      },
    });

    expect(block.image).to.deep.equal({
      source: "media",
      mediaId: LAYOUT_MEDIA_ID,
    });
  });

  it("fills the four new Block fields into a layout stored before them", async function () {
    // Stored before the amendment and never migrated: what comes back is
    // complete and says what it said, because every new field defaults.
    const stored = withoutBlockStyling(MINIMAL_LAYOUT_STORED);

    expect(await normalizeHeroLayout(stored)).to.deep.equal(
      MINIMAL_LAYOUT_STORED,
    );
  });

  it("normalises what it already normalised", async function () {
    const once = await normalizeHeroLayout(MINIMAL_LAYOUT);
    const twice = await normalizeHeroLayout(once);

    expect(twice).to.deep.equal(once);
  });

  it("reads a cleared key as one that is not given", async function () {
    const block = await blockOf({
      ...MINIMAL_TEXT_BLOCK,
      size: null,
      color: "",
      weight: null,
    });

    expect(block).to.include({
      size: "md",
      color: "default",
      weight: "normal",
    });
  });

  it("reads null as the reset to the Default Hero Layout", async function () {
    expect(await normalizeHeroLayout(null)).to.equal(null);
    expect(await normalizeHeroLayout(undefined)).to.equal(null);
  });

  it("refuses something that is not an object at all", async function () {
    expect(await refusalOf("lg")).to.deep.equal([
      {
        field: "heroLayout",
        code: "invalid_format",
        params: { format: "object" },
      },
    ]);
  });

  INVALID_LAYOUTS.forEach(function (fixture) {
    it(`refuses ${fixture.name}`, async function () {
      expect(codesOf(await refusalOf(fixture.input))).to.deep.equal(
        fixture.expected,
      );
    });
  });

  it("keeps a rich-text length fault back while the shape is broken", async function () {
    // Sanitising runs after the whole layout was walked, so a length fault of
    // its own would arrive behind faults that stand later in the body than it
    // does. It waits for a sound shape instead, like the media check.
    const details = await refusalOf(
      layoutOf(
        {
          ...MINIMAL_RICHTEXT_BLOCK,
          html: { de: `<p>${"b".repeat(10001)}</p>` },
        },
        { ...MINIMAL_TEXT_BLOCK, zone: "middle" },
      ),
    );

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[1].zone", code: "invalid_enum" },
    ]);
  });

  it("refuses the Default Hero Layout of a Catalog without a Portal Name", async function () {
    // The derived default gives the logo Block `alt: { de: <catalog.name> }`
    // and the contract names no fallback, so a legacy Catalog that carries a
    // branding logo and no name derives a layout its own normaliser will not
    // take back. Only the derived read path reaches it - the instance catalog
    // PUT requires the name - and an alt fallback is a change to the Shared
    // contract in all three repos, not a local decision.
    const derived = defaultHeroLayout({
      name: "",
      logo: { source: "media", mediaId: LAYOUT_MEDIA_ID },
    });

    expect(codesOf(await refusalOf(derived))).to.deep.equal([
      { field: "heroLayout.blocks[0].alt.de", code: "required" },
    ]);
  });

  it("names the cap it measured against on an over-long text", async function () {
    const details = await refusalOf(
      layoutOf({ ...MINIMAL_TEXT_BLOCK, text: { de: "a".repeat(201) } }),
    );

    expect(details[0].params).to.deep.equal({ max: 200, actual: 201 });
  });
});

/**
 * The field tables of the amended contract, written out rather than read off
 * the normaliser: a table this file and the spec agree on is what tells a
 * fixture that lost a key from one the normaliser never fills.
 */
const COMMON_BLOCK_FIELDS = [
  "id",
  "type",
  "zone",
  "outerSpacing",
  "innerSpacing",
  "width",
  "align",
  "panel",
  "offset",
  "layer",
  "homeOnly",
  "hideOnMobile",
];

const CONTENT_BLOCK_FIELDS = {
  text: ["text", "size", "color", "weight", "shadow"],
  richtext: ["html", "size", "color", "shadow"],
  image: ["image", "alt", "maxHeight", "invertInDarkMode"],
};

const PANEL_FIELDS = ["color", "opacity", "radius", "blur"];
const OFFSET_FIELDS = ["x", "y"];

const keysOf = (object) => Object.keys(object).sort();

describe("the Blocks of the Shared contract's fixtures", function () {
  const FIXTURES = {
    "the Default Hero Layout": DEFAULT_HERO_LAYOUT,
    "the acceptance fixture": ACCEPTANCE_LAYOUT,
    "the crowded-layout example": layoutOf(CROWDED_RICHTEXT_BLOCK),
    "a stored minimal layout": MINIMAL_LAYOUT_STORED,
  };

  Object.entries(FIXTURES).forEach(function ([name, layout]) {
    it(`carries every field of the tables and no other in ${name}`, function () {
      for (const block of layout.blocks) {
        expect(keysOf(block)).to.deep.equal(
          [...COMMON_BLOCK_FIELDS, ...CONTENT_BLOCK_FIELDS[block.type]].sort(),
          `Block ${block.id}`,
        );

        if (block.panel) {
          expect(keysOf(block.panel)).to.deep.equal([...PANEL_FIELDS].sort());
        }

        expect(keysOf(block.offset)).to.deep.equal([...OFFSET_FIELDS].sort());
      }
    });
  });
});

describe("the colours of a Hero Layout Block", function () {
  afterEach(function () {
    sinon.restore();
  });

  const COLORS = ["default", "primary", "secondary", "white", "#1a2b3c"];

  COLORS.forEach(function (color) {
    it(`takes ${color} on a text Block`, async function () {
      expect(await blockOf({ ...MINIMAL_TEXT_BLOCK, color })).to.include({
        color,
      });
    });

    it(`takes ${color} on a rich-text Block`, async function () {
      expect(await blockOf({ ...MINIMAL_RICHTEXT_BLOCK, color })).to.include({
        color,
      });
    });
  });

  it("takes an upper-case hex", async function () {
    expect(
      await blockOf({ ...MINIMAL_TEXT_BLOCK, color: "#AABBCC" }),
    ).to.include({ color: "#AABBCC" });
  });

  it("leaves the hex-only rule of a Background where it was", async function () {
    let refused;
    try {
      await normalizeBackground({
        version: 1,
        type: "color",
        light: "primary",
      });
    } catch (error) {
      refused = error;
    }

    expect(refused).to.be.instanceOf(ValidationError);
    expect(codesOf(refused.errors)).to.deep.equal([
      { field: "background.light", code: "invalid_format" },
    ]);
  });
});

describe("the Panel of a Hero Layout Block", function () {
  beforeEach(function () {
    stubInstanceMedia();
  });

  afterEach(function () {
    sinon.restore();
  });

  /** The Panel of a Block that carries the given one. */
  const panelOf = async (panel) =>
    (await blockOf({ ...MINIMAL_TEXT_BLOCK, panel })).panel;

  it("fills the four Glas defaults for an empty Panel", async function () {
    expect(await panelOf({})).to.deep.equal(GLAS_PANEL);
  });

  it("leaves the other three at their defaults for each key given alone", async function () {
    const given = {
      color: "black",
      opacity: 0,
      radius: "full",
      blur: false,
    };

    for (const [key, value] of Object.entries(given)) {
      expect(await panelOf({ [key]: value }), key).to.deep.equal({
        ...GLAS_PANEL,
        [key]: value,
      });
    }
  });

  it("stores no Panel for null and for a Block that names none", async function () {
    expect(await panelOf(null)).to.equal(null);
    expect((await blockOf(MINIMAL_TEXT_BLOCK)).panel).to.equal(null);
  });

  it("normalises a Panel it already normalised", async function () {
    const once = await panelOf({ opacity: 20 });

    expect(await panelOf(once)).to.deep.equal(once);
  });

  it("normalises the legacy word none away", async function () {
    expect(await panelOf("none")).to.equal(null);
  });

  it("normalises the legacy word translucent into the Glas Panel", async function () {
    expect(await panelOf("translucent")).to.deep.equal(GLAS_PANEL);
  });

  /** The details a Block with the given Panel is refused with. */
  const refusedPanel = (panel) =>
    refusalOf(layoutOf({ ...MINIMAL_TEXT_BLOCK, panel }));

  ["white", "black", "primary", "secondary", "#1a2b3c"].forEach(
    function (color) {
      it(`takes ${color} as a Panel colour`, async function () {
        expect(await panelOf({ color })).to.include({ color });
      });
    },
  );

  it("leaves black out of the text vocabulary", async function () {
    // The two vocabularies are not one: `black` is the Panel's, `default` the
    // text's, and neither crosses over.
    const details = await refusalOf(
      layoutOf({ ...MINIMAL_TEXT_BLOCK, color: "black" }),
    );

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].color", code: "invalid_format" },
    ]);
  });

  it("takes both ends of the opacity, nought included", async function () {
    // A Panel at nought with `blur: true` is pure frosting: no fault and no
    // warning, by contract.
    for (const opacity of [0, 100]) {
      expect(await panelOf({ opacity }), `${opacity}`).to.include({ opacity });
    }
  });

  it("refuses an opacity below nought as a percentage", async function () {
    expect(await refusedPanel({ opacity: -1 })).to.deep.equal([
      {
        field: "heroLayout.blocks[0].panel.opacity",
        code: "invalid_format",
        params: { format: "percentage" },
      },
    ]);
  });

  it("names the five steps it measured a radius against", async function () {
    const details = await refusedPanel({ radius: "xl" });

    expect(details[0].params).to.deep.equal({
      allowed: ["none", "sm", "md", "lg", "full"],
    });
  });

  it("names the format of a bad colour, a bad blur and a Panel that is no object", async function () {
    const formats = await Promise.all(
      [{ color: "greenish" }, { blur: "yes" }, 3].map(async (panel) => {
        const [detail] = await refusedPanel(panel);
        return detail.params.format;
      }),
    );

    expect(formats).to.deep.equal(["color", "boolean", "object"]);
  });

  it("names every fault of one Panel at its own path", async function () {
    const details = await refusedPanel({
      color: "default",
      opacity: 101,
      radius: "xl",
      blur: "yes",
      glow: 1,
    });

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].panel.color", code: "invalid_format" },
      { field: "heroLayout.blocks[0].panel.opacity", code: "invalid_format" },
      { field: "heroLayout.blocks[0].panel.radius", code: "invalid_enum" },
      { field: "heroLayout.blocks[0].panel.blur", code: "invalid_format" },
      { field: "heroLayout.blocks[0].panel.glow", code: "unknown_field" },
    ]);
  });
});

describe("the placement of a Hero Layout Block", function () {
  beforeEach(function () {
    stubInstanceMedia();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("fills align on every Block type", async function () {
    for (const block of [
      MINIMAL_TEXT_BLOCK,
      MINIMAL_RICHTEXT_BLOCK,
      MINIMAL_IMAGE_BLOCK,
    ]) {
      expect(await blockOf(block), block.type).to.include({ align: "auto" });
    }
  });

  ["auto", "left", "center", "right"].forEach(function (align) {
    it(`takes ${align} on a text, a rich-text and an image Block`, async function () {
      for (const block of [
        MINIMAL_TEXT_BLOCK,
        MINIMAL_RICHTEXT_BLOCK,
        MINIMAL_IMAGE_BLOCK,
      ]) {
        expect(await blockOf({ ...block, align }), block.type).to.include({
          align,
        });
      }
    });
  });

  it("names the four alignments it measured against", async function () {
    // On an image Block: `align` is a common field, so the fault reads the
    // same wherever it is raised.
    const details = await refusalOf(
      layoutOf({ ...MINIMAL_IMAGE_BLOCK, align: "justify" }),
    );

    expect(details).to.deep.equal([
      {
        field: "heroLayout.blocks[0].align",
        code: "invalid_enum",
        params: { allowed: ["auto", "left", "center", "right"] },
      },
    ]);
  });

  it("fills layer on every Block type", async function () {
    for (const block of [
      MINIMAL_TEXT_BLOCK,
      MINIMAL_RICHTEXT_BLOCK,
      MINIMAL_IMAGE_BLOCK,
    ]) {
      expect(await blockOf(block), block.type).to.include({ layer: "back" });
    }
  });

  ["back", "front"].forEach(function (layer) {
    it(`takes ${layer} as a layer`, async function () {
      expect(await blockOf({ ...MINIMAL_TEXT_BLOCK, layer })).to.include({
        layer,
      });
    });
  });

  it("names the two layers it measured against", async function () {
    const details = await refusalOf(
      layoutOf({ ...MINIMAL_TEXT_BLOCK, layer: "top" }),
    );

    expect(details).to.deep.equal([
      {
        field: "heroLayout.blocks[0].layer",
        code: "invalid_enum",
        params: { allowed: ["back", "front"] },
      },
    ]);
  });

  /** The offset of a Block that carries the given one. */
  const offsetOf = async (offset) =>
    (await blockOf({ ...MINIMAL_TEXT_BLOCK, offset })).offset;

  /** The details a Block with the given offset is refused with. */
  const refusedOffset = (offset) =>
    refusalOf(layoutOf({ ...MINIMAL_TEXT_BLOCK, offset }));

  it("fills offset on every Block type", async function () {
    for (const block of [
      MINIMAL_TEXT_BLOCK,
      MINIMAL_RICHTEXT_BLOCK,
      MINIMAL_IMAGE_BLOCK,
    ]) {
      expect((await blockOf(block)).offset, block.type).to.deep.equal({
        x: 0,
        y: 0,
      });
    }
  });

  [-3, -0.5, 0, 2.5, 3].forEach(function (rem) {
    it(`takes ${rem} rem on both axes`, async function () {
      expect(await offsetOf({ x: rem, y: rem })).to.deep.equal({
        x: rem,
        y: rem,
      });
    });
  });

  it("leaves the other axis at nought for an offset on one alone", async function () {
    expect(await offsetOf({ y: 1.5 })).to.deep.equal({ x: 0, y: 1.5 });
    expect(await offsetOf({ x: -2 })).to.deep.equal({ x: -2, y: 0 });
  });

  it("fills both axes for an offset given as an empty object", async function () {
    expect(await offsetOf({})).to.deep.equal({ x: 0, y: 0 });
  });

  [3.5, -4, 0.25, "1", NaN, Infinity].forEach(function (rem) {
    it(`refuses ${String(rem)} as a step off the grid`, async function () {
      expect(await refusedOffset({ x: rem })).to.deep.equal([
        {
          field: "heroLayout.blocks[0].offset.x",
          code: "invalid_format",
          params: { format: "offset_step" },
        },
      ]);
    });
  });

  it("names the axis that is off the grid", async function () {
    expect(codesOf(await refusedOffset({ x: 0.5, y: 0.75 }))).to.deep.equal([
      { field: "heroLayout.blocks[0].offset.y", code: "invalid_format" },
    ]);
  });

  it("names both axes when both are off the grid", async function () {
    expect(codesOf(await refusedOffset({ x: 4, y: -4 }))).to.deep.equal([
      { field: "heroLayout.blocks[0].offset.x", code: "invalid_format" },
      { field: "heroLayout.blocks[0].offset.y", code: "invalid_format" },
    ]);
  });

  it("refuses an offset that is no object as a whole", async function () {
    expect(await refusedOffset(0.5)).to.deep.equal([
      {
        field: "heroLayout.blocks[0].offset",
        code: "invalid_format",
        params: { format: "object" },
      },
    ]);
  });

  it("refuses an unknown key inside an offset", async function () {
    expect(codesOf(await refusedOffset({ x: 1, z: 1 }))).to.deep.equal([
      { field: "heroLayout.blocks[0].offset.z", code: "unknown_field" },
    ]);
  });

  it("stores the crest of the acceptance fixture unchanged", async function () {
    expect(await blockOf(CREST_BLOCK)).to.deep.equal(CREST_BLOCK);
  });

  it("normalises an offset it already normalised", async function () {
    const once = await offsetOf({ x: -1.5, y: 3 });

    expect(await offsetOf(once)).to.deep.equal(once);
  });
});

describe("rich text on the way into a Hero Layout", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("stores a script tag and a javascript link sanitised, not refused", async function () {
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: {
        de: '<p>Hallo<script>alert(1)</script></p><p><a href="javascript:alert(1)">Klick</a></p>',
      },
    });

    expect(block.html.de).to.not.include("script");
    expect(block.html.de).to.not.include("javascript:");
    expect(block.html.de).to.include("<p>Hallo</p>");
  });

  it("drops a tag the allowlist does not name and keeps its text", async function () {
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: { de: "<h1>Titel</h1><p>Text</p>" },
    });

    expect(block.html.de).to.equal("Titel<p>Text</p>");
  });

  it("sanitises every locale of the Block", async function () {
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: {
        de: '<p onclick="x()">Hallo</p>',
        en: '<p style="color:red">Hello</p>',
      },
    });

    expect(block.html).to.deep.equal({
      de: "<p>Hallo</p>",
      en: "<p>Hello</p>",
    });
  });

  it("keeps an https and a mailto link", async function () {
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: {
        de: '<p><a href="https://example.org">Link</a> <a href="mailto:a@example.org">Mail</a></p>',
      },
    });

    expect(block.html.de).to.equal(
      '<p><a href="https://example.org">Link</a> <a href="mailto:a@example.org">Mail</a></p>',
    );
  });

  it("drops a relative href, and target and rel with it", async function () {
    // `target` and `rel` stand in the allowlist's ALLOWED_ATTR, but DOMPurify
    // runs every attribute that is not one of its own URI-safe names through
    // ALLOWED_URI_REGEXP, and `_blank`/`noopener` are no https or mailto URI.
    // The frozen config of the contract therefore stores neither.
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: {
        de: '<p><a href="/impressum" target="_blank" rel="noopener">Rechtliches</a></p>',
      },
    });

    expect(block.html.de).to.equal("<p><a>Rechtliches</a></p>");
  });

  it("stores the class-passed HTML of a rich-text Block", async function () {
    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: {
        de:
          '<p class="hero-align-center promo">' +
          '<span class="hero-size-lg hero-color-primary">Gro\u00df</span>' +
          '<span class="hero-size-huge"> Rest</span>' +
          "</p>",
        en:
          '<p><span data-color="#FF0000" style="color:#FF0000">Red</span>' +
          '<span data-color="red"> Bad</span></p>',
      },
    });

    expect(block.html).to.deep.equal({
      de:
        '<p class="hero-align-center">' +
        '<span class="hero-size-lg hero-color-primary">Gro\u00df</span> Rest' +
        "</p>",
      en: '<p><span data-color="#ff0000">Red</span> Bad</p>',
    });
  });

  it("stores a text that only junk classes pushed over the stored cap", async function () {
    const text = "a".repeat(5000);

    const block = await blockOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: { de: '<p class="' + "promo ".repeat(1000).trim() + '">' + text },
    });

    expect(block.html.de).to.equal("<p>" + text + "</p>");
  });

  it("measures the raw cap before sanitising and the stored cap after", async function () {
    const raw = await refusalOf(
      layoutOf({
        ...MINIMAL_RICHTEXT_BLOCK,
        html: { de: `<p>${"a".repeat(50000)}</p>` },
      }),
    );
    const sanitized = await refusalOf(
      layoutOf({
        ...MINIMAL_RICHTEXT_BLOCK,
        html: { de: `<p>${"b".repeat(10001)}</p>` },
      }),
    );

    expect(raw[0].params.max).to.equal(50000);
    expect(sanitized[0].params.max).to.equal(10000);
  });
});

describe("the media a Hero Layout Block may point at", function () {
  afterEach(function () {
    sinon.restore();
  });

  async function reasonFor(media) {
    stubMediaLookup(() => media);
    const details = await refusalOf(layoutOf(MINIMAL_IMAGE_BLOCK));

    expect(details).to.have.length(1);
    expect(details[0].field).to.equal("heroLayout.blocks[0].image");
    expect(details[0].code).to.equal("invalid_custom");
    return details[0].params.reason;
  }

  it("takes a public instance image", async function () {
    stubInstanceMedia();

    expect((await blockOf(MINIMAL_IMAGE_BLOCK)).image).to.deep.equal(
      MINIMAL_IMAGE_BLOCK.image,
    );
  });

  it("refuses an external reference", async function () {
    stubInstanceMedia();

    const details = await refusalOf(
      layoutOf({
        ...MINIMAL_IMAGE_BLOCK,
        image: { source: "external", url: "https://example.org/bild.png" },
      }),
    );

    expect(details[0].params.reason).to.equal("external");
  });

  it("refuses a medium the instance scope does not know", async function () {
    expect(await reasonFor(null)).to.equal("not_instance");
  });

  it("refuses an intern medium", async function () {
    expect(
      await reasonFor(instanceImage(LAYOUT_MEDIA_ID, { visibility: "intern" })),
    ).to.equal("not_public");
  });

  it("refuses a document", async function () {
    expect(
      await reasonFor(
        instanceImage(LAYOUT_MEDIA_ID, {
          kind: "document",
          mimeType: "application/pdf",
        }),
      ),
    ).to.equal("not_image");
  });

  it("names every Block that points at a medium it may not", async function () {
    stubMediaLookup(() => null);

    const details = await refusalOf(
      layoutOf(MINIMAL_IMAGE_BLOCK, {
        ...MINIMAL_IMAGE_BLOCK,
        id: "i2",
      }),
    );

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].image", code: "invalid_custom" },
      { field: "heroLayout.blocks[1].image", code: "invalid_custom" },
    ]);
  });

  it("asks the media library only once the shape is sound", async function () {
    stubMediaLookup(() => null);

    const details = await refusalOf(
      layoutOf({ ...MINIMAL_IMAGE_BLOCK, zone: "middle" }),
    );

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].zone", code: "invalid_enum" },
    ]);
    expect(MediaManager.getMedia.called).to.equal(false);
  });
});

describe("the instance catalog write takes a Hero Layout", function () {
  beforeEach(function () {
    stubInstanceMedia();
    sinon.stub(CatalogManager, "getInstanceCatalog").resolves(null);
    sinon.stub(CatalogManager, "createCatalog").resolves({ id: "c1" });
    sinon.stub(CatalogManager, "updateCatalog").resolves({ id: "c1" });
  });

  afterEach(function () {
    sinon.restore();
    ThemeExportCache.invalidateAll();
  });

  /** What the write handed the catalog manager. */
  const written = () => CatalogManager.updateCatalog.firstCall.args[0];

  /** Runs a catalog write and hands back the details it refused with. */
  async function refusedWrite(body) {
    try {
      await CatalogService.updateInstanceCatalog({
        _id: "c1",
        name: "Portal",
        ...body,
      });
    } catch (error) {
      expect(error).to.be.instanceOf(ValidationError);
      return error.errors;
    }

    throw new Error("the write was accepted");
  }

  it("stores the layout normalised", async function () {
    await CatalogService.updateInstanceCatalog({
      _id: "c1",
      name: "Portal",
      heroLayout: MINIMAL_LAYOUT,
    });

    expect(written().heroLayout).to.deep.equal(MINIMAL_LAYOUT_STORED);
  });

  it("stores the layout on a catalog that is being created", async function () {
    await CatalogService.createInstanceCatalog({
      name: "Portal",
      heroLayout: MINIMAL_LAYOUT,
    });

    expect(
      CatalogManager.createCatalog.firstCall.args[0].heroLayout,
    ).to.deep.equal(MINIMAL_LAYOUT_STORED);
  });

  it("stores null as the reset to the Default Hero Layout", async function () {
    await CatalogService.updateInstanceCatalog({
      _id: "c1",
      name: "Portal",
      heroLayout: null,
    });

    expect(written().heroLayout).to.equal(null);
  });

  it("leaves the stored layout alone when the body does not name it", async function () {
    await CatalogService.updateInstanceCatalog({ _id: "c1", name: "Portal" });

    expect(written()).to.not.have.property("heroLayout");
  });

  it("refuses a bad layout at its path in the catalog body", async function () {
    const details = await refusedWrite({
      heroLayout: layoutOf({ ...MINIMAL_TEXT_BLOCK, zone: "middle" }),
    });

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].zone", code: "invalid_enum" },
    ]);
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });

  it("names the missing Portal Name and the faults of the layout together", async function () {
    const details = await refusedWrite({
      name: "",
      heroLayout: { version: 2, blocks: [] },
    });

    expect(codesOf(details)).to.deep.equal([
      { field: "name", code: "required" },
      { field: "heroLayout.version", code: "invalid_enum" },
    ]);
  });

  it("refuses a Block whose medium may not carry the Hero", async function () {
    MediaManager.getMedia.callsFake(async () => null);

    const details = await refusedWrite({
      heroLayout: layoutOf(MINIMAL_IMAGE_BLOCK),
    });

    expect(codesOf(details)).to.deep.equal([
      { field: "heroLayout.blocks[0].image", code: "invalid_custom" },
    ]);
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });

  it("keeps refusing a heroLayout key on every tenant catalog write", async function () {
    sinon.stub(CatalogManager, "getCatalogByTenant").resolves(null);

    const writes = {
      createTenantCatalog: (body) =>
        CatalogService.createTenantCatalog("t1", body),
      updateTenantCatalog: (body) =>
        CatalogService.updateTenantCatalog("t1", body),
      updateCatalog: (body) =>
        CatalogService.updateCatalog({ tenantId: "t1", ...body }),
    };

    for (const [name, write] of Object.entries(writes)) {
      let refused;
      try {
        await write({ _id: "c1", name: "Katalog", heroLayout: MINIMAL_LAYOUT });
      } catch (error) {
        refused = error;
      }

      expect(refused, name).to.be.instanceOf(ValidationError);
      expect(codesOf(refused.errors), name).to.deep.equal([
        { field: "heroLayout", code: "unknown_field" },
      ]);
    }
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });
});

describe("catalog routes: saving a Hero Layout", function () {
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
    CatalogManager.updateCatalog.resetHistory();
    MediaManager.getMedia.callsFake(async (mediaId, tenantId) =>
      tenantId == null ? instanceImage(mediaId) : null,
    );
    ThemeExportCache.invalidateAll();
  });

  afterEach(function () {
    CatalogManager.getInstanceCatalog.callsFake(async () => fixtureCatalog);
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

  const storeLayout = (heroLayout) =>
    put("/catalog", ADMIN, { _id: FIXTURE_ID, name: "Katalog", heroLayout });

  /** What the write handed the catalog manager. */
  const written = () => CatalogManager.updateCatalog.firstCall.args[0];

  it("stores the Default Hero Layout of the contract unchanged", async function () {
    const res = await storeLayout(DEFAULT_HERO_LAYOUT);

    expect(res.status).to.equal(200);
    expect(written().heroLayout).to.deep.equal(DEFAULT_HERO_LAYOUT);
  });

  it("stores the crest of the acceptance fixture unchanged", async function () {
    const res = await storeLayout(layoutOf(CREST_BLOCK));

    expect(res.status).to.equal(200);
    expect(written().heroLayout.blocks[0]).to.deep.equal(CREST_BLOCK);
  });

  it("stores the crowded rich-text Block of the contract unchanged", async function () {
    const res = await storeLayout(layoutOf(CROWDED_RICHTEXT_BLOCK));

    expect(res.status).to.equal(200);
    expect(written().heroLayout.blocks[0]).to.deep.equal(
      CROWDED_RICHTEXT_BLOCK,
    );
  });

  it("stores a minimal layout with every default filled", async function () {
    const res = await storeLayout(MINIMAL_LAYOUT);

    expect(res.status).to.equal(200);
    expect(written().heroLayout).to.deep.equal(MINIMAL_LAYOUT_STORED);
  });

  it("stores a script tag and a javascript link sanitised", async function () {
    await storeLayout(
      layoutOf({
        ...MINIMAL_RICHTEXT_BLOCK,
        html: {
          de: '<p>Hallo<script>alert(1)</script> <a href="javascript:alert(1)">Klick</a></p>',
        },
      }),
    );

    const html = written().heroLayout.blocks[0].html.de;
    expect(html).to.not.include("script");
    expect(html).to.not.include("javascript:");
  });

  it("answers a bad layout with 400 and JSON paths, not a 500", async function () {
    const res = await storeLayout(
      layoutOf(
        { ...MINIMAL_TEXT_BLOCK, zone: "middle" },
        { ...MINIMAL_TEXT_BLOCK, text: { en: "Welcome" } },
      ),
    );

    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal("ValidationError");
    expect(
      res.body.details.map(({ field, code }) => ({ field, code })),
    ).to.deep.equal([
      { field: "heroLayout.blocks[0].zone", code: "invalid_enum" },
      { field: "heroLayout.blocks[1].text.de", code: "required" },
      { field: "heroLayout.blocks[1].id", code: "duplicate_id" },
    ]);
    expect(CatalogManager.updateCatalog.called).to.equal(false);
  });

  it("resets to the Default Hero Layout on heroLayout null", async function () {
    const res = await storeLayout(null);

    expect(res.status).to.equal(200);
    expect(written().heroLayout).to.equal(null);

    CatalogManager.getInstanceCatalog.callsFake(
      async () => new Catalog({ ...fixtureCatalog, heroLayout: null }),
    );
    const bundle = await get("/catalog/themes", ADMIN);

    expect(
      bundle.body.heroLayout.blocks.map((block) => block.id),
    ).to.deep.equal(["default-title", "default-subtitle"]);
  });

  it("keeps refusing a heroLayout key on the tenant catalog PUT", async function () {
    const res = await put(`/${TENANT}/catalog`, OWNER, {
      _id: FIXTURE_ID,
      type: "single",
      tenantId: TENANT,
      slug: "fx-slug",
      name: "Katalog",
      heroLayout: MINIMAL_LAYOUT,
    });

    expect(res.status).to.equal(400);
    expect(res.body.details).to.deep.equal([
      { field: "heroLayout", code: "unknown_field" },
    ]);
  });

  it("changes the Theme Bundle ETag when a Hero Layout is saved", async function () {
    const before = await get("/catalog/themes", ADMIN);
    expect(before.body.background).to.deep.equal(VARIANT_BACKGROUND);

    const stored = layoutOf({ ...MINIMAL_TEXT_BLOCK, text: { de: "Neu" } });
    const write = await storeLayout(stored);
    expect(write.status).to.equal(200);

    CatalogManager.getInstanceCatalog.callsFake(
      async () =>
        new Catalog({ ...fixtureCatalog, heroLayout: written().heroLayout }),
    );
    const after = await get("/catalog/themes", ADMIN);

    expect(after.body.heroLayout.blocks[0].text).to.deep.equal({ de: "Neu" });
    expect(after.headers.etag).to.not.equal(before.headers.etag);
  });

  it("normalises the two legacy Panel words on the way in", async function () {
    const res = await storeLayout(
      layoutOf(
        { ...MINIMAL_TEXT_BLOCK, panel: "none" },
        { ...MINIMAL_TEXT_BLOCK, id: "t2", panel: "translucent" },
      ),
    );

    expect(res.status).to.equal(200);
    expect(
      written().heroLayout.blocks.map((block) => block.panel),
    ).to.deep.equal([null, GLAS_PANEL]);
  });

  it("delivers a stored legacy Panel normalised in the Theme Bundle", async function () {
    // A layout written before the Panel became an object, never migrated: the
    // export translates the two words, so a storefront that no longer knows
    // them never meets one.
    CatalogManager.getInstanceCatalog.callsFake(
      async () => new Catalog({ ...fixtureCatalog, heroLayout: LEGACY_LAYOUT }),
    );

    const bundle = await get("/catalog/themes", ADMIN);

    expect(bundle.status).to.equal(200);
    expect(
      bundle.body.heroLayout.blocks.map((block) => block.panel),
    ).to.deep.equal([null, GLAS_PANEL, null]);
  });

  it("delivers the placement of a stored Block in the Theme Bundle", async function () {
    CatalogManager.getInstanceCatalog.callsFake(
      async () =>
        new Catalog({
          ...fixtureCatalog,
          heroLayout: { ...MINIMAL_LAYOUT_STORED, blocks: [CREST_BLOCK] },
        }),
    );

    const bundle = await get("/catalog/themes", ADMIN);

    expect(bundle.status).to.equal(200);
    expect(bundle.body.heroLayout.blocks[0]).to.deep.include({
      align: "center",
      offset: { x: 0, y: 0.5 },
      layer: "front",
    });
  });

  it("returns the stored layout as it is on GET /api/catalog", async function () {
    CatalogManager.getInstanceCatalog.callsFake(
      async () =>
        new Catalog({ ...fixtureCatalog, heroLayout: MINIMAL_LAYOUT_STORED }),
    );

    const res = await get("/catalog", ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body.heroLayout).to.deep.equal(MINIMAL_LAYOUT_STORED);
  });
});
