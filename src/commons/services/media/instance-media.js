const {
  absoluteMediaReferenceUrl,
  enrichMediaReference,
  plainObject,
} = require("./media-reference");

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
 * The branding as it goes out: both references enriched with the URL they
 * resolve to, and `logoUrl`/`faviconUrl` derived from them. Those two stay the
 * fields every frontend reads until the vue-app picks media itself.
 *
 * Wherever a reference stands it is what the branding is, so the read field is
 * derived from it and the legacy address it may sit next to is ignored; only an
 * empty site keeps whatever legacy address is stored.
 *
 * The read fields are absolute. Branding leaves the platform: the store front
 * fetches the logo server side, with no origin of its own to resolve against, so
 * a relative address there is worthless the same way it is in a mail (§4.4). The
 * `logo`/`favicon` references keep the relative URL every other reference site
 * carries.
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
    plain[field.readField] =
      absoluteMediaReferenceUrl(reference ?? plain[field.readField], null) ??
      "";
  }

  return plain;
}

/**
 * A legal document as it goes out: its reference enriched, and the resolved
 * address mirrored into `url` — the field every frontend reads today. A
 * document served from the media library is a plain URL to its readers, so the
 * derived form says `source: "url"` and nothing has to know about media.
 *
 * Like the branding read fields, `url` is absolute: it ends up in an `href` in
 * a storefront that does not share the origin of the platform, and in the
 * record of what a user accepted at registration — both follow it from outside,
 * where a relative address resolves against the wrong host (§4.4). A site that
 * holds only a legacy address keeps it, absolute for the same reason.
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
    return plain.url
      ? { ...plain, url: absoluteMediaReferenceUrl(plain.url, null) }
      : plain;
  }

  // Wherever a reference stands it is what the document is, so the address is
  // derived from it and a legacy one beside it is ignored.
  return {
    ...plain,
    reference,
    source: "url",
    url: absoluteMediaReferenceUrl(reference, null) ?? "",
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
