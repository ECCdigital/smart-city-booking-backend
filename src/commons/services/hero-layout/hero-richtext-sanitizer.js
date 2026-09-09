const createDOMPurify = require("dompurify");

const { ValidationError } = require("../../../errors/ValidationError");
const SchemaUtils = require("../../utilities/schemaUtils");

/**
 * Rich-text allowlist v1 of the Shared contract (hero-layout spec).
 *
 * The storefront carries a verbatim copy of this object for its own DOMPurify
 * run on render. A change here is a change to the contract in all three
 * repos, never a local decision. It is passed to every `sanitize()` call and
 * never installed with `setConfig()`, hooks or `IN_PLACE`.
 */
const HERO_RICHTEXT_ALLOWLIST = Object.freeze({
  ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li"],
  ALLOWED_ATTR: ["href", "target", "rel"],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
});

// Raw input longer than this is refused before it reaches the parser.
const HERO_RICHTEXT_MAX_RAW_LENGTH = 50000;

// The stored form per locale: what is left after sanitising.
const HERO_RICHTEXT_MAX_SANITIZED_LENGTH = 10000;

let purifierPromise = null;

/**
 * Loads jsdom and builds the one DOMPurify instance of this process, lazily
 * on the first rich-text save. jsdom is heavy and only rich-text Blocks need
 * it, so it stays off the boot path; the dynamic import is the same pattern
 * as `loadFileType` in `media-file-type.js` and keeps loading unchanged
 * should a future jsdom ship as ESM only.
 *
 * @returns {Promise<Object>} The DOMPurify instance bound to the window.
 */
function loadHeroRichTextPurifier() {
  if (!purifierPromise) {
    purifierPromise = import("jsdom").then(({ JSDOM }) =>
      createDOMPurify(new JSDOM("").window),
    );
  }

  return purifierPromise;
}

/**
 * Sanitises the HTML of one locale of a rich-text Block with the frozen
 * allowlist, enforcing the two length rules of the contract.
 *
 * @param {string} html - The raw HTML of one locale. Must be a string: the
 *   normaliser has checked the shape of the LocalizedString before this runs.
 * @param {string} field - JSON path of the locale string, e.g.
 *   `heroLayout.blocks[0].html.de`; reported as-is on failure.
 * @returns {Promise<string>} The sanitised HTML.
 * @throws {ValidationError} `max_length` when the raw input exceeds
 *   50 000 characters or the sanitised result exceeds 10 000. `params.max`
 *   is the cap that was hit, `params.actual` the length measured at that
 *   stage (raw, or after sanitising).
 */
async function sanitizeHeroRichText(html, field) {
  if (html.length > HERO_RICHTEXT_MAX_RAW_LENGTH) {
    throw maxLengthError(field, HERO_RICHTEXT_MAX_RAW_LENGTH, html.length);
  }

  const purifier = await loadHeroRichTextPurifier();
  const sanitized = purifier.sanitize(html, HERO_RICHTEXT_ALLOWLIST);

  if (sanitized.length > HERO_RICHTEXT_MAX_SANITIZED_LENGTH) {
    throw maxLengthError(
      field,
      HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
      sanitized.length,
    );
  }

  return sanitized;
}

function maxLengthError(field, max, actual) {
  return new ValidationError([
    { field, code: SchemaUtils.ERROR_CODES.maxLength, params: { max, actual } },
  ]);
}

module.exports = {
  HERO_RICHTEXT_ALLOWLIST,
  HERO_RICHTEXT_MAX_RAW_LENGTH,
  HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
  loadHeroRichTextPurifier,
  sanitizeHeroRichText,
};
