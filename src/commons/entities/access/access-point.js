const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const SchemaUtils = require("../../utilities/schemaUtils");
const {
  accessPointSchemaDefinition,
  AccessPointType,
  AccessPointMode,
  VALIDATION_RULE_TYPES,
} = require("../../schemas/accessPointSchema");

const AccessCapability = Object.freeze({
  REMOTE: "remote",
  AUTHORIZATION: "authorization",
});

const AccessPointState = Object.freeze({
  OPEN: "open",
  CLOSED: "closed",
  UNKNOWN: "unknown",
});

const SCAN_CODE_BYTES = 24;

const FIELDS_HIDDEN_IN_RESPONSES = ["scanCode", "previousScanCodes"];

/**
 * Create a scan code: an opaque, url-safe random value that identifies an
 * access point in the printed QR code.
 *
 * @returns {string} A new scan code
 */
function generateScanCode() {
  return crypto.randomBytes(SCAN_CODE_BYTES).toString("base64url");
}

function deriveSupportedModes(capabilities = []) {
  const hasRemote = capabilities.includes(AccessCapability.REMOTE);
  const hasAuthorization = capabilities.includes(
    AccessCapability.AUTHORIZATION,
  );
  const modes = [];

  if (hasRemote) {
    modes.push(AccessPointMode.REMOTE);
  }

  if (hasAuthorization) {
    modes.push(AccessPointMode.AUTHORIZATION);
  }

  if (hasRemote && hasAuthorization) {
    modes.push(AccessPointMode.BOTH);
  }

  return modes;
}

/**
 * A physical access point (door or locker) of a tenant that the platform can
 * open and close through a provider.
 */
class AccessPoint {
  /**
   * Create a new access point object.
   * @param {Object} params Access point parameters
   */
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(accessPointSchemaDefinition),
    );

    Object.keys(accessPointSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });

    this.metadata = params.metadata || {};
  }

  /**
   * Export the persisted fields of the access point. Runtime information such
   * as `metadata` is left out.
   *
   * @returns {Object} Access point data to be stored
   */
  toDocument() {
    return Object.keys(accessPointSchemaDefinition).reduce((document, key) => {
      document[key] = this[key];
      return document;
    }, {});
  }

  /**
   * Export the access point for API responses. Scan codes never leave the
   * server: they are only meaningful on the printed QR code and are resolved
   * server-side.
   *
   * @returns {Object} Access point data without its scan codes
   */
  toResponse() {
    const response = this.toDocument();
    FIELDS_HIDDEN_IN_RESPONSES.forEach((field) => delete response[field]);
    return response;
  }

  /**
   * Validate the access point
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, accessPointSchemaDefinition);
    return true;
  }

  /**
   * Create a new access point. Its scan code is always minted here, a given
   * `id` is kept so migrated points stay joinable to bookings and audit logs.
   *
   * @param {Object} params Access point parameters
   * @returns {AccessPoint} The created access point
   */
  static create(params = {}) {
    const accessPoint = new AccessPoint({
      ...params,
      id: params.id || uuidv4(),
      scanCode: generateScanCode(),
    });
    accessPoint.validate();
    return accessPoint;
  }
}

module.exports = {
  AccessPoint,
  AccessCapability,
  AccessPointType,
  AccessPointMode,
  AccessPointState,
  VALIDATION_RULE_TYPES,
  deriveSupportedModes,
};
