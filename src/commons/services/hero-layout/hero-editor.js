const {
  normalizeBackground,
  normalizeHeroLayout,
} = require("./hero-layout-schema");
const { exportBackground, exportHeroLayout } = require("./hero-export");
const { HeroValidationErrors, carries } = require("./hero-validation");
const SchemaUtils = require("../../utilities/schemaUtils");

const ERROR_CODES = SchemaUtils.ERROR_CODES;

/**
 * The payload of the Hero Editor: the Hero Layout and the Background as one
 * object, on the way in and on the way out. The two live in different
 * documents — the layout on the Catalog, the Background on the instance
 * branding — but the editor writes them together, so the reading and the
 * refusal of both belong in one place.
 *
 * Both objects are normalised before either is written, so a save that is
 * refused leaves both documents as they were, and both faults arrive in one
 * answer.
 */

/**
 * Reads one of the two objects, recording what it refuses. A key that is not
 * there at all is `required`: the editor sends the whole Hero every time, so a
 * missing key is a broken client rather than a partial save, and answering it
 * keeps a save from silently resetting what it did not mention.
 *
 * @param {Object} body - The request body.
 * @param {string} key - `heroLayout` or `background`.
 * @param {function(*, string): Promise<?Object>} normalize - Its normaliser.
 * @param {HeroValidationErrors} errors - The run's details.
 * @returns {Promise<?Object>} The object as it is stored, or null.
 */
async function readObject(body, key, normalize, errors) {
  if (!carries(body, key)) {
    errors.add(key, ERROR_CODES.required);
    return null;
  }

  try {
    return await normalize(body[key], key);
  } catch (error) {
    errors.absorb(error);
    return null;
  }
}

/**
 * The stored form of both objects of a Hero Editor payload. Everything the body
 * carries besides them is ignored rather than refused — the `name` of the
 * preview, the `isDefault` of the read route — so the body of a read or a
 * preview can be handed to the save unchanged. The Portal Name is written
 * through `PUT /api/catalog`, never here.
 *
 * @param {?Object} body - What the client sent.
 * @returns {Promise<{heroLayout: ?Object, background: ?Object}>} Both as they
 *   are stored; `null` each means "use the derived default".
 * @throws {ValidationError} One detail per fault of either object, in body
 *   order, JSON paths as fields.
 */
async function normalizeHeroEditorBody(body) {
  const source = body ?? {};
  const errors = new HeroValidationErrors();

  const heroLayout = await readObject(
    source,
    "heroLayout",
    normalizeHeroLayout,
    errors,
  );
  const background = await readObject(
    source,
    "background",
    normalizeBackground,
    errors,
  );

  errors.throwIfAny();

  return { heroLayout, background };
}

/**
 * What the three routes answer: both objects in export form — the derived
 * defaults where nothing is stored, every media reference enriched — next to
 * the Portal Name the default layout is derived with.
 *
 * @param {Object} state - What is delivered.
 * @param {?Object} state.heroLayout - The stored layout, or null.
 * @param {?Object} state.background - The stored Background, or null.
 * @param {?string} state.name - The Catalog's `name`, the Portal Name.
 * @param {?Object} state.logo - The branding logo reference, or null.
 * @returns {Promise<{heroLayout: Object, background: Object, name: string}>}
 */
async function exportHeroEditorState({ heroLayout, background, name, logo }) {
  const portalName = name ?? "";

  const [exportedLayout, exportedBackground] = await Promise.all([
    exportHeroLayout(heroLayout ?? null, { name: portalName, logo }),
    exportBackground(background ?? null),
  ]);

  return {
    heroLayout: exportedLayout,
    background: exportedBackground,
    name: portalName,
  };
}

module.exports = { exportHeroEditorState, normalizeHeroEditorBody };
