const { enrichMediaReference } = require("./media-reference");

/**
 * The reference sites of the instance itself (§4.9 of the media spec): the two
 * branding images and the three legal documents. This module is the single
 * place that knows where they sit and how they are read on the way out.
 *
 * Instance media carry no tenant, so every reference here resolves against the
 * instance scope of the delivery route.
 *
 * As everywhere else in the media work, normalisation happens on the way out
 * only: what is stored stays untouched, so the media import (B7) still finds
 * the legacy forms it has to convert.
 */

// Where the branding reference is stored, and the legacy read field it feeds.
const BRANDING_REFERENCE_FIELDS = Object.freeze([
  { reference: "logo", readField: "logoUrl" },
  { reference: "favicon", readField: "faviconUrl" },
]);

// The legal documents of the instance, each a `{ source, url, fileName }` that
// gained a `reference`.
const DOCUMENT_FIELDS = Object.freeze([
  "dataProtection",
  "legalNotice",
  "termsAndConditions",
]);

/**
 * Strips the mongoose wrapping off a stored sub-object.
 *
 * @param {Object} value - The stored value.
 * @returns {Object} A plain copy.
 */
function plainObject(value) {
  return typeof value?.toObject === "function"
    ? value.toObject()
    : { ...value };
}

/**
 * The branding as it goes out: both references enriched with the URL they
 * resolve to, and `logoUrl`/`faviconUrl` derived from them. Those two stay the
 * fields every frontend reads until the vue-app picks media itself; without a
 * reference they keep whatever legacy URL is stored.
 *
 * @param {Object|null} branding - The stored branding.
 * @returns {Object|null} The branding as it goes out.
 */
function exportInstanceBranding(branding) {
  if (!branding) {
    return branding ?? null;
  }

  const plain = plainObject(branding);

  for (const field of BRANDING_REFERENCE_FIELDS) {
    const reference = enrichMediaReference(plain[field.reference], null);

    plain[field.reference] = reference || null;
    plain[field.readField] = reference?.url ?? plain[field.readField] ?? "";
  }

  return plain;
}

/**
 * A legal document as it goes out: its reference enriched, and the resolved
 * address mirrored into `url` — the field every frontend reads today. A
 * document served from the media library is a plain URL to its readers, so the
 * derived form says `source: "url"` and nothing has to know about media.
 *
 * @param {Object|null} document - The stored legal document.
 * @returns {Object|null} The document as it goes out.
 */
function exportInstanceDocument(document) {
  if (!document) {
    return document ?? null;
  }

  const plain = plainObject(document);
  const reference = enrichMediaReference(plain.reference, null);

  if (!reference) {
    return plain;
  }

  return {
    ...plain,
    reference,
    source: "url",
    url: reference.url ?? plain.url ?? "",
  };
}

/**
 * The branding reference sites of an instance — the input of the save-time
 * validation. Branding is served to anonymous visitors, so these must be
 * public media.
 *
 * @param {Object} instance - The instance being saved.
 * @returns {Array<Object|string|null>}
 */
function instanceBrandingReferences(instance) {
  return BRANDING_REFERENCE_FIELDS.map(
    (field) => instance?.branding?.[field.reference],
  );
}

/**
 * The legal document reference sites of an instance.
 *
 * @param {Object} instance - The instance being saved.
 * @returns {Array<Object|string|null>}
 */
function instanceDocumentReferences(instance) {
  return DOCUMENT_FIELDS.map((field) => instance?.[field]?.reference);
}

/**
 * The instance as it goes out, with every media reference site derived.
 *
 * @param {Object} instance - The stored instance.
 * @returns {Object} A plain copy carrying the derived read fields.
 */
function exportInstanceMedia(instance) {
  const plain = { ...instance };

  plain.branding = exportInstanceBranding(plain.branding);

  for (const field of DOCUMENT_FIELDS) {
    if (plain[field] !== undefined) {
      plain[field] = exportInstanceDocument(plain[field]);
    }
  }

  return plain;
}

module.exports = {
  BRANDING_REFERENCE_FIELDS,
  DOCUMENT_FIELDS,
  exportInstanceBranding,
  exportInstanceDocument,
  exportInstanceMedia,
  instanceBrandingReferences,
  instanceDocumentReferences,
};
