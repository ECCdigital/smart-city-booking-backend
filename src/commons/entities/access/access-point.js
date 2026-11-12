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

/**
 * How many rotated-out scan codes an access point keeps. Old codes only serve
 * to tell a stale sticker apart from one that was never issued, so a short
 * window is enough.
 */
const PREVIOUS_SCAN_CODES_CAP = 5;

const FIELDS_HIDDEN_IN_RESPONSES = ["scanCode", "previousScanCodes"];

/**
 * Create a scan code: an opaque, url-safe random value that identifies an
 * access point in the printed QR code - a door, or a Fach of a
 * Schließfachanlage with its own list (`locker-system-compartments.js`).
 *
 * @returns {string} A new scan code
 */
function generateScanCode() {
  return crypto.randomBytes(SCAN_CODE_BYTES).toString("base64url");
}

/**
 * The scan codes after a rotation, of a door or of a Fach of a
 * Schließfachanlage alike: the current code moves to the front of
 * `previousScanCodes` (capped at {@link PREVIOUS_SCAN_CODES_CAP}, the
 * oldest fall off) and a fresh code takes its place.
 *
 * @param {{scanCode: string, previousScanCodes?: string[]}} holder The
 *   access point or Fach, only read
 * @returns {{scanCode: string, previousScanCodes: string[]}} The new codes
 */
function rotatedScanCodes({ scanCode, previousScanCodes = [] }) {
  return {
    scanCode: generateScanCode(),
    previousScanCodes: [scanCode, ...previousScanCodes].slice(
      0,
      PREVIOUS_SCAN_CODES_CAP,
    ),
  };
}

/** A copy of the access point or Fach without its scan codes. */
function withoutScanCodes(holder) {
  const copy = { ...holder };
  FIELDS_HIDDEN_IN_RESPONSES.forEach((field) => delete copy[field]);
  return copy;
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
   * server-side. That holds for the codes of the Fächer of a
   * Schließfachanlage in `config.compartments` as well (tickets#1055).
   *
   * @returns {Object} Access point data without its scan codes
   */
  toResponse() {
    const response = withoutScanCodes(this.toDocument());

    if (Array.isArray(response.config?.compartments)) {
      response.config = {
        ...response.config,
        compartments: response.config.compartments.map(withoutScanCodes),
      };
    }
    return response;
  }

  /**
   * Rotate the scan code: the current code is pushed to the front of
   * `previousScanCodes` (capped, oldest fall off) and a fresh random code takes
   * its place. Old stickers are void at once; in-flight opens are unaffected
   * because access points are resolved per request. Rotation is the only
   * revocation mechanism - there is no token to expire.
   *
   * @returns {AccessPoint} This access point, so callers can chain.
   */
  rotateScanCode() {
    Object.assign(this, rotatedScanCodes(this));
    return this;
  }

  /**
   * Rotate the scan code of one Fach of a Schließfachanlage that carries its
   * own list (tickets#1061), by the door's rule (see {@link rotatedScanCodes}).
   * The list is replaced, never written into, since `toDocument` shares
   * `config` by reference.
   *
   * @param {string} compartmentId The UUID of the Fach
   * @returns {boolean} Whether the Anlage carries that Fach, so its code was
   *   rotated
   */
  rotateCompartmentScanCode(compartmentId) {
    const compartments = this.config?.compartments;
    if (
      !Array.isArray(compartments) ||
      !compartments.some((compartment) => compartment.id === compartmentId)
    ) {
      return false;
    }
    this.config = {
      ...this.config,
      compartments: compartments.map((compartment) =>
        compartment.id === compartmentId
          ? { ...compartment, ...rotatedScanCodes(compartment) }
          : compartment,
      ),
    };
    return true;
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
  PREVIOUS_SCAN_CODES_CAP,
  deriveSupportedModes,
  generateScanCode,
  rotatedScanCodes,
};
