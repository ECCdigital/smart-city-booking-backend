const {
  BLOCK_DEFAULTS,
  DEFAULT_BACKGROUND,
  DEFAULT_TEXT_SIZE,
  exportPanel,
} = require("./hero-layout-schema");
const { defaultHeroLayout } = require("./hero-default-layout");
const { enrichHeroMediaReference } = require("./hero-media");

/**
 * The export form of the Hero Layout objects — what the Theme Bundle and the
 * editor routes deliver, as opposed to what is stored. Four things happen
 * here: a missing object becomes the default the backend derives, every media
 * reference is enriched with its URL and dimensions, a Panel that is still one
 * of the two legacy words becomes the object the contract names, and a Block
 * stored before the amendment gains the fields it does not carry yet.
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
 * The defaults of a Block of the given type. They are read off
 * `BLOCK_DEFAULTS` rather than written out again, so what the export fills in
 * and what the normaliser stores cannot drift apart. `size` is beside them
 * because it is the one field the amendment gave to a family rather than to
 * every Block.
 *
 * @param {string} type - The Block's `type`.
 * @returns {Object} What a Block of that type carries when it names nothing.
 */
function blockDefaults(type) {
  const common = { ...BLOCK_DEFAULTS, offset: { ...BLOCK_DEFAULTS.offset } };

  return type === "richtext" ? { ...common, size: DEFAULT_TEXT_SIZE } : common;
}

/**
 * One Block as it goes out: every field of the amended contract on it, its
 * Panel in the contract's form, and an image Block with its reference
 * enriched.
 *
 * A Block stored before the amendment carries neither the fields it added nor
 * an object where the Panel is — it still holds one of the two legacy words.
 * Both are answered here rather than in a migration, so the dev databases stay
 * as they are and what the storefront and the editor read is complete either
 * way. Only a key that carries nothing is filled - `??=` fills an absent key
 * and an explicit `null`, so a stored value the author chose is never
 * overwritten with its default.
 *
 * @param {Object} block - The stored Block.
 * @returns {Promise<Object>} The Block as it goes out.
 */
async function exportBlock(block) {
  const exported = { ...block, panel: exportPanel(block.panel) };

  for (const [key, value] of Object.entries(blockDefaults(block.type))) {
    exported[key] ??= value;
  }

  if (exported.type !== "image") {
    return exported;
  }

  return { ...exported, image: await enrichHeroMediaReference(block.image) };
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
