const { validateMediaReference } = require("../schemas/mediaSchema");

/**
 * The legal document types a tenant can file (spec §2.2). The label of the four
 * known types comes from the admin UI translation, never from the stored
 * `title` — the server stores types, not wordings. `other` is the escape hatch
 * that keeps the list extensible without a release, and carries the only
 * human-given title.
 */
const LEGAL_DOCUMENT_TYPE = {
  DATA_PROTECTION: "dataProtection",
  LEGAL_NOTICE: "legalNotice",
  TERMS_AND_CONDITIONS: "termsAndConditions",
  RIGHT_OF_WITHDRAWAL: "rightOfWithdrawal",
  OTHER: "other",
};

const LEGAL_DOCUMENT_TYPES = Object.values(LEGAL_DOCUMENT_TYPE);

/**
 * Checks the shape rules of `tenant.legalDocuments` (spec §2.3): the title
 * belongs to `other` and only there, every known type appears at most once, and
 * two `other` documents may not share a title.
 *
 * A present `reference` is checked with the same rule the media reference
 * schema enforces (§2.1). The schema hook only guards the Mongoose path, and
 * `SchemaUtils.validate` does not descend into subdocuments — without this the
 * entity would accept a reference the model rejects.
 *
 * @param {Array} documents - The legal documents to check.
 * @returns {string|null} The first violation, or null if the list is valid.
 */
function getLegalDocumentsError(documents) {
  if (!Array.isArray(documents)) {
    return "legalDocuments must be an array";
  }

  const seenTypes = new Set();
  const seenOtherTitles = new Set();

  for (const legalDocument of documents) {
    if (
      !legalDocument ||
      typeof legalDocument !== "object" ||
      Array.isArray(legalDocument)
    ) {
      return "Each legal document must be an object";
    }

    if (!LEGAL_DOCUMENT_TYPES.includes(legalDocument.type)) {
      return `type must be one of ${LEGAL_DOCUMENT_TYPES.join(", ")}`;
    }

    if (
      legalDocument.reference !== undefined &&
      legalDocument.reference !== null &&
      !validateMediaReference(legalDocument.reference)
    ) {
      return "reference must carry exactly one of mediaId (source: media) or url (source: external)";
    }

    if (legalDocument.type === LEGAL_DOCUMENT_TYPE.OTHER) {
      if (
        typeof legalDocument.title !== "string" ||
        !legalDocument.title.trim()
      ) {
        return "title is required for legal documents of type other";
      }

      const title = legalDocument.title.trim();
      if (seenOtherTitles.has(title)) {
        return "title must be unique among legal documents of type other";
      }
      seenOtherTitles.add(title);
      continue;
    }

    if (legalDocument.title !== undefined && legalDocument.title !== "") {
      return "title must be empty for legal documents of a known type";
    }

    if (seenTypes.has(legalDocument.type)) {
      return "type must be unique among legal documents";
    }
    seenTypes.add(legalDocument.type);
  }

  return null;
}

module.exports = {
  LEGAL_DOCUMENT_TYPE,
  LEGAL_DOCUMENT_TYPES,
  getLegalDocumentsError,
};
