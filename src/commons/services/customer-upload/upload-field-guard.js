const TenantManager = require("../../data-managers/tenant-manager");
const { DOMAIN } = require("../authorization");
const {
  getUploadFieldDefinitionsError,
  normalizeCustomerUploadSettings,
  normalizeUploadFieldDefinitions,
} = require("./customer-upload-rules");

/**
 * Whether the upload fields of a bookable may be stored: every field gets a
 * stable id, then the fields are checked against the formats of the tenant
 * and the instance limits. The tenant is read as the domain reads it, so
 * the check does not depend on who saves.
 *
 * @param {Object} bookable The bookable to be stored, changed in place
 * @param {string} tenantId The tenant of the route
 * @throws {BadRequestError} With the reason of the first invalid field
 */
async function assertUploadFieldsStorable(bookable, tenantId) {
  const definitions = normalizeUploadFieldDefinitions(
    bookable.uploadFieldDefinitions,
  );
  if (Array.isArray(definitions) && definitions.length === 0) {
    return;
  }

  const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
  const error = getUploadFieldDefinitionsError(
    definitions,
    normalizeCustomerUploadSettings(tenant?.customerUploads),
  );
  if (error) {
    throw error;
  }
}

module.exports = { assertUploadFieldsStorable };
