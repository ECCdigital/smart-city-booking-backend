const { DEFAULT_BACKGROUND } = require("./hero-layout-schema");
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

module.exports = { exportBackground };
