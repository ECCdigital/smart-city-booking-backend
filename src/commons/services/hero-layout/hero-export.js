const { DEFAULT_BACKGROUND } = require("./hero-layout-schema");
const { defaultHeroLayout } = require("./hero-default-layout");
const { enrichHeroMediaReference } = require("./hero-media");

/**
 * The export form of the Hero Layout objects — what the Theme Bundle and the
 * editor routes deliver, as opposed to what is stored. Two things happen here:
 * a missing object becomes the default the backend derives, and every media
 * reference is enriched with its URL and dimensions.
 */

/**
 * The Background as it goes out. An instance that stored none, one that reset
 * it and one whose branding is switched off all get the default `poly`
 * variant, so the key is on every bundle.
 *
 * @param {?Object} background - The stored Background, or null.
 * @returns {Promise<Object>} The Background as it goes out.
 */
async function exportBackground(background) {
  const effective = background ?? DEFAULT_BACKGROUND;

  if (effective.type !== "image") {
    return { ...effective };
  }

  return {
    ...effective,
    image: await enrichHeroMediaReference(effective.image),
  };
}

/**
 * One Block as it goes out: an image Block with its reference enriched, any
 * other Block as it is.
 *
 * @param {Object} block - The stored Block.
 * @returns {Promise<Object>} The Block as it goes out.
 */
async function exportBlock(block) {
  if (block.type !== "image") {
    return { ...block };
  }

  return { ...block, image: await enrichHeroMediaReference(block.image) };
}

/**
 * The Hero Layout as it goes out. A Catalog that stores none gets the Default
 * Hero Layout derived from its Portal Name and the branding logo, so the key
 * is on every bundle; a stored layout is delivered as it is. In both cases
 * every image Block carries the URL and dimensions of its medium.
 *
 * @param {?Object} heroLayout - The stored layout, or null for the default.
 * @param {Object} instance - What the default is derived from.
 * @param {?string} instance.name - The Catalog's `name`, the Portal Name.
 * @param {?Object} instance.logo - The branding logo reference, or null.
 * @returns {Promise<Object>} The layout as it goes out.
 */
async function exportHeroLayout(heroLayout, { name, logo }) {
  const effective = heroLayout ?? defaultHeroLayout({ name, logo });

  return {
    ...effective,
    blocks: await Promise.all((effective.blocks ?? []).map(exportBlock)),
  };
}

module.exports = { exportBackground, exportHeroLayout };
