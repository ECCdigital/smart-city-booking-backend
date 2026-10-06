const { MEDIA_REFERENCE_SOURCE } = require("../../schemas/mediaSchema");
const {
  BLOCK_DEFAULTS,
  HERO_LAYOUT_DEFAULTS,
  HERO_LAYOUT_VERSION,
} = require("./hero-layout-schema");

/**
 * The Default Hero Layout (hero-layout spec, Shared contract): what the
 * backend derives at read time when a Catalog stores no Hero Layout, and what
 * the editor's "reset to default" lands on. It reproduces the look
 * of the Hero before the editor existed - the branding logo on the right,
 * the Portal Name and the slogan on the left - and is never stored:
 * `heroLayout: null` on the Catalog means "use this", so a Catalog that was
 * never touched keeps following whatever the default becomes.
 *
 * Two of its Blocks depend on the instance: the logo Block is there only when
 * the branding carries a logo medium, the title Block only when the Portal
 * Name is non-empty. There is no fallback title - a Catalog without a name
 * shows the slogan alone.
 */

// The slogan every Default Hero Layout ends with. It replaced the removed
// `hero.subtitle`.
const DEFAULT_SLOGAN = Object.freeze({
  de: "Entdecken Sie unsere Angebote",
  en: "Discover our offers",
});

/**
 * The Portal Name a Catalog's `name` carries. Whitespace alone is no name:
 * the same reading decides here which Blocks the default gets and, at the
 * instance catalog write, whether the name is there at all.
 *
 * @param {*} name - The Catalog's `name`.
 * @returns {string} The Portal Name, or an empty string when there is none.
 */
function portalNameOf(name) {
  return typeof name === "string" && name.trim() !== "" ? name : "";
}

/**
 * The logo Block: the branding logo, stacked above the title on mobile.
 *
 * @param {string} mediaId - The medium of the branding logo.
 * @param {string} portalName - The alt text of the logo.
 * @returns {Object} The Block in its stored form.
 */
function logoBlock(mediaId, portalName) {
  return {
    id: "default-logo",
    type: "image",
    zone: "middle-right",
    ...BLOCK_DEFAULTS,
    image: { source: MEDIA_REFERENCE_SOURCE.MEDIA, mediaId },
    alt: { de: portalName },
    maxHeight: "sm",
    invertInDarkMode: true,
  };
}

/**
 * The title Block: the Portal Name, bold in the primary colour.
 *
 * @param {string} portalName - The Portal Name.
 * @returns {Object} The Block in its stored form.
 */
function titleBlock(portalName) {
  return {
    id: "default-title",
    type: "text",
    zone: "middle-left",
    ...BLOCK_DEFAULTS,
    text: { de: portalName },
    size: "lg",
    color: "primary",
    weight: "bold",
    shadow: false,
  };
}

/**
 * The slogan Block, in both languages.
 *
 * @returns {Object} The Block in its stored form.
 */
function sloganBlock() {
  return {
    id: "default-subtitle",
    type: "text",
    zone: "middle-left",
    ...BLOCK_DEFAULTS,
    text: { ...DEFAULT_SLOGAN },
    size: "2xl",
    color: "default",
    weight: "bold",
    shadow: false,
  };
}

/**
 * Derives the Default Hero Layout of one Catalog, in the stored form of the
 * contract: media references are `{ source, mediaId }` and get their URL and
 * dimensions on the way out like any stored layout.
 *
 * @param {Object} instance - What the layout is derived from.
 * @param {?string} instance.name - The Catalog's `name`, the Portal Name.
 * @param {?Object} instance.logo - The branding logo reference, stored or
 *   enriched; a legacy logo that is no medium yields no logo Block.
 * @returns {Object} A fresh layout, complete, with one to three Blocks.
 */
function defaultHeroLayout({ name, logo }) {
  const portalName = portalNameOf(name);
  const blocks = [];

  if (logo?.source === MEDIA_REFERENCE_SOURCE.MEDIA && logo.mediaId) {
    blocks.push(logoBlock(logo.mediaId, portalName));
  }

  if (portalName) {
    blocks.push(titleBlock(portalName));
  }

  blocks.push(sloganBlock());

  return {
    version: HERO_LAYOUT_VERSION,
    ...HERO_LAYOUT_DEFAULTS,
    blocks,
  };
}

module.exports = { defaultHeroLayout, portalNameOf };
