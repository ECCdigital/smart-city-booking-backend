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
  ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "span"],
  ALLOWED_ATTR: ["href", "target", "rel", "class", "data-color"],
  ADD_URI_SAFE_ATTR: ["data-color"],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
});

/**
 * The class vocabulary v1 of the Shared contract, one entry per element that
 * may carry anything at all: a group holds the tokens it accepts, and one
 * token of a group survives. `span` alone takes a custom `data-color`.
 *
 * There is no `hero-align-auto` and no `hero-color-black` — the absence of a
 * class is what „inherits from the Block“ means. The storefront carries a
 * verbatim copy, so a change here is a change to the contract.
 */
const HERO_RICHTEXT_CLASSES = Object.freeze({
  p: Object.freeze({
    align: Object.freeze([
      "hero-align-left",
      "hero-align-center",
      "hero-align-right",
    ]),
  }),
  span: Object.freeze({
    size: Object.freeze([
      "hero-size-xs",
      "hero-size-sm",
      "hero-size-md",
      "hero-size-lg",
      "hero-size-xl",
      "hero-size-2xl",
    ]),
    color: Object.freeze([
      "hero-color-default",
      "hero-color-primary",
      "hero-color-secondary",
      "hero-color-white",
    ]),
  }),
});

// The custom colour of a span, stored lower-cased. This test, and not
// DOMPurify, which passes any value once the attribute is URI-safe, is the
// security boundary for `data-color`.
const HERO_RICHTEXT_COLOR = /^#[0-9a-f]{6}$/i;

// Raw input longer than this is refused before it reaches the parser.
const HERO_RICHTEXT_MAX_RAW_LENGTH = 50000;

// The stored form per locale: what is left after sanitising.
const HERO_RICHTEXT_MAX_SANITIZED_LENGTH = 10000;

let runtimePromise = null;

/**
 * Loads jsdom and builds the one DOMPurify instance of this process, lazily
 * on the first rich-text save. jsdom is heavy and only rich-text Blocks need
 * it, so it stays off the boot path; the dynamic import is the same pattern
 * as `loadFileType` in `media-file-type.js` and keeps loading unchanged
 * should a future jsdom ship as ESM only. The window is kept beside the
 * purifier because the class pass parses the sanitised HTML once more.
 *
 * @returns {Promise<{purifier: Object, window: Object}>} The purifier and the
 *   window it is bound to.
 */
function loadHeroRichTextRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("jsdom").then(({ JSDOM }) => {
      const { window } = new JSDOM("");

      return { purifier: createDOMPurify(window), window };
    });
  }

  return runtimePromise;
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
 *   stage (raw, or after sanitising). A tree too deep for the parser to
 *   walk is refused against the sanitised cap with the raw length, the one
 *   measurement there is; see `sanitizeDeepTree`.
 */
async function sanitizeHeroRichText(html, field) {
  if (html.length > HERO_RICHTEXT_MAX_RAW_LENGTH) {
    throw maxLengthError(field, HERO_RICHTEXT_MAX_RAW_LENGTH, html.length);
  }

  const { purifier, window } = await loadHeroRichTextRuntime();
  const sanitized = sanitizeDeepTree(
    () =>
      applyHeroClassPass(
        purifier.sanitize(html, HERO_RICHTEXT_ALLOWLIST),
        window,
      ),
    field,
    html,
  );

  if (sanitized.length > HERO_RICHTEXT_MAX_SANITIZED_LENGTH) {
    throw maxLengthError(
      field,
      HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
      sanitized.length,
    );
  }

  return sanitized;
}

/**
 * Runs both passes over one tree and turns the parser giving up on its depth
 * into the contract's answer.
 *
 * jsdom walks and serialises a tree recursively, so markup nested thousands
 * of levels deep — well under the raw cap, `"<ul><li>".repeat(3000)` is
 * 24 001 characters — overflows the call stack inside `sanitize()` or the
 * class pass. Where exactly depends on the stack at the time of the call, so
 * there is no depth to cap in the contract, and the contract names none. It
 * does not need to: a kept level costs at least seven characters, so any tree
 * deep enough to break the parser would have exceeded the sanitised cap had
 * sanitising finished, and every tree that fits the cap (≤ 1 428 levels) is
 * far below where the parser fails. The overflow is therefore refused as the
 * measurement it stands in for, `max_length` against the sanitised cap, and
 * never surfaces as a 500. Anything but a stack overflow is rethrown.
 *
 * @param {Function} passes - Both passes over the tree, run once.
 * @param {string} field - JSON path of the locale string, for the error.
 * @param {string} html - The raw input, whose length is what can be reported.
 * @returns {string} The sanitised HTML.
 * @throws {ValidationError} `max_length` when the parser overflowed.
 */
function sanitizeDeepTree(passes, field, html) {
  try {
    return passes();
  } catch (error) {
    if (error instanceof RangeError) {
      throw maxLengthError(
        field,
        HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
        html.length,
      );
    }

    throw error;
  }
}

/**
 * The class pass: a walk over the sanitised DOM that keeps exactly the class
 * vocabulary and nothing else. It is a second step after the allowlist pass,
 * not a rewrite of the HTML text, so what it reads is what the parser saw.
 *
 * @param {string} html - The output of the allowlist pass.
 * @param {Object} window - The jsdom window the purifier is bound to.
 * @returns {string} The HTML with the vocabulary enforced.
 */
function applyHeroClassPass(html, window) {
  const root = window.document.createElement("div");
  root.innerHTML = html;
  keepClassVocabulary(root);

  return root.innerHTML;
}

/**
 * Walks the children of one element, deepest first: a span is repaired only
 * once its own children are, so what an unwrap hands up has been through the
 * pass already and no element is walked twice.
 *
 * @param {Object} element - The element whose children are walked.
 * @returns {void}
 */
function keepClassVocabulary(element) {
  for (const child of Array.from(element.children)) {
    keepClassVocabulary(child);
    repairClasses(child);
  }
}

/**
 * The repair rules of the contract on one element: everything outside the
 * vocabulary is dropped rather than the element refused, an emptied `class`
 * is removed, and a `span` left without attributes is unwrapped.
 *
 * @param {Object} element - The element to repair.
 * @returns {void}
 */
function repairClasses(element) {
  const vocabulary = HERO_RICHTEXT_CLASSES[element.localName];

  if (!vocabulary) {
    element.removeAttribute("class");
    element.removeAttribute("data-color");
    return;
  }

  const tokens = vocabularyTokens(element.getAttribute("class"), vocabulary);

  if (tokens.length > 0) {
    element.setAttribute("class", tokens.join(" "));
  } else {
    element.removeAttribute("class");
  }

  repairCustomColor(element, vocabulary, tokens);

  if (element.localName === "span" && element.attributes.length === 0) {
    element.replaceWith(...element.childNodes);
  }
}

/**
 * The custom colour of a `span`, kept only as a lower-cased `#rrggbb`. This
 * test is the security boundary of the attribute: DOMPurify passes any value
 * once `ADD_URI_SAFE_ATTR` keeps it out of `ALLOWED_URI_REGEXP`.
 *
 * A `hero-color-*` token beside it wins and the attribute goes. An editor
 * cannot produce that pair, so the input is hand-forged, and the ambiguous
 * case should lead away from the attribute that later becomes paint.
 *
 * @param {Object} element - The element to repair.
 * @param {Object} vocabulary - The groups this element may carry.
 * @param {Array<string>} tokens - The class tokens that survived.
 * @returns {void}
 */
function repairCustomColor(element, vocabulary, tokens) {
  const value = element.getAttribute("data-color");

  if (value === null) {
    return;
  }

  const named = tokens.some((token) => vocabulary.color?.includes(token));

  if (!named && vocabulary.color && HERO_RICHTEXT_COLOR.test(value)) {
    element.setAttribute("data-color", value.toLowerCase());
  } else {
    element.removeAttribute("data-color");
  }
}

/**
 * The tokens of one `class` attribute that stand in the vocabulary, in the
 * order the author wrote them. A token outside it is dropped, `hero-`-prefixed
 * or not, and of two tokens of the same group the first in document order
 * wins — class order decides nothing in CSS, so keeping one of the author's
 * two choices beats discarding both.
 *
 * @param {?string} value - The `class` attribute, or `null` when there is none.
 * @param {Object} vocabulary - The groups this element may carry.
 * @returns {Array<string>} The tokens that survive.
 */
function vocabularyTokens(value, vocabulary) {
  const groups = Object.entries(vocabulary);
  const taken = new Set();
  const kept = [];

  for (const token of (value ?? "").split(/\s+/)) {
    const group = groups.find(([, tokens]) => tokens.includes(token));

    if (group && !taken.has(group[0])) {
      taken.add(group[0]);
      kept.push(token);
    }
  }

  return kept;
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
  loadHeroRichTextRuntime,
  sanitizeHeroRichText,
};
