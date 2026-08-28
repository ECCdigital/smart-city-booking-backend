const { enrichMediaReference, plainObject } = require("./media-reference");

/**
 * The reference sites of a tenant (§4.2 of the legal-documents spec): the legal
 * documents it files. This module is the single place that knows where they sit
 * and how they are read on the way out.
 *
 * Tenant documents reference tenant media only — the strict scope separation of
 * §4.9 of the media spec runs in both directions, so every reference here
 * resolves against the tenant of the document.
 *
 * As everywhere else in the media work, normalisation happens on the way out
 * only: what is stored stays untouched.
 */

/**
 * A legal document as it goes out: its reference enriched with the URL it
 * resolves to, and an empty site spelled out as `null` so every document has
 * the same shape. Unlike the instance documents there is no legacy read field
 * to mirror — the tenant carries the reference form from the start.
 *
 * @param {Object} document - The stored legal document.
 * @param {string} tenantId - Tenant the document belongs to.
 * @returns {Object} The document as it goes out.
 */
function exportTenantDocument(document, tenantId) {
  const plain = plainObject(document);

  return {
    ...plain,
    reference: enrichMediaReference(plain.reference, tenantId) || null,
  };
}

/**
 * The legal document reference sites of a tenant — the input of the save-time
 * validation.
 *
 * @param {Object} tenant - The tenant being saved.
 * @returns {Array<Object|string|null>}
 */
function tenantDocumentReferences(tenant) {
  return (tenant?.legalDocuments || []).map((document) => document?.reference);
}

/**
 * The tenant as it goes out, with every media reference site derived.
 *
 * @param {Object} tenant - The stored tenant.
 * @returns {Object} A plain copy carrying the enriched references.
 */
function exportTenantMedia(tenant) {
  const plain = { ...tenant };

  if (Array.isArray(plain.legalDocuments)) {
    plain.legalDocuments = plain.legalDocuments.map((document) =>
      exportTenantDocument(document, plain.id),
    );
  }

  return plain;
}

module.exports = {
  exportTenantMedia,
  tenantDocumentReferences,
};
