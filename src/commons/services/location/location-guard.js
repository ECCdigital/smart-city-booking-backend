const { isDeepStrictEqual } = require("node:util");

const { ValidationError } = require("../../../errors/ValidationError");
const SchemaUtils = require("../../utilities/schemaUtils");

const { ERROR_CODES } = SchemaUtils;
const INVALID_TYPE_OBJECT = "invalid_type_object";

/** The sources of a point the input writes: search, by hand, NUKI. */
const POINT_SOURCES = Object.freeze(["photon", "manual", "nuki"]);

/** The fields of an address; each one filled is content of the location. */
const ADDRESS_FIELDS = Object.freeze([
  "street",
  "house_number",
  "postcode",
  "city",
]);

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAbsent = (value) => value === undefined || value === null;

const isFilled = (value) =>
  typeof value === "string" ? value.trim() !== "" : !isAbsent(value);

/**
 * Whether two locations say the same, whatever the order of their keys: a
 * client that sends the stored location back has not changed it.
 */
const sameContent = (location, storedLocation) =>
  !isAbsent(storedLocation) &&
  isDeepStrictEqual(asJson(location), asJson(storedLocation));

const asJson = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/**
 * Whether the location says where something is in words: an address, a
 * display text, an addition, or an old location given as text only.
 */
function hasContent(location) {
  if (typeof location === "string") {
    return isFilled(location);
  }
  return (
    isFilled(location.display_address) ||
    ADDRESS_FIELDS.some((key) => isFilled(location.address?.[key])) ||
    isFilled(location.meta?.additional)
  );
}

/**
 * Checks the known fields of a location object; unknown ones are left alone.
 *
 * @returns {{errors: Object[], hasPoint: boolean}}
 */
function checkShape(location, storedLocation) {
  const errors = [];
  const refuse = (field, code, params = {}) =>
    errors.push({ field: `location${field}`, code, params });
  const expectString = (field, value) => {
    if (!isAbsent(value) && typeof value !== "string") {
      refuse(field, ERROR_CODES.type_string);
    }
  };
  const expectObject = (field, value) => {
    if (isAbsent(value) || isPlainObject(value)) {
      return true;
    }
    refuse(field, INVALID_TYPE_OBJECT);
    return false;
  };

  expectString(".display_address", location.display_address);

  const { address } = location;
  if (expectObject(".address", address) && address) {
    ADDRESS_FIELDS.forEach((key) =>
      expectString(`.address.${key}`, address[key]),
    );
  }

  const { meta } = location;
  if (expectObject(".meta", meta) && meta) {
    expectString(".meta.additional", meta.additional);
    const source = meta.source;
    // An old source (`nominatim`, `legacy`) stays as long as it is the
    // stored one: stored locations are never rewritten.
    if (
      !isAbsent(source) &&
      !POINT_SOURCES.includes(source) &&
      !(isPlainObject(storedLocation) && storedLocation.meta?.source === source)
    ) {
      refuse(".meta.source", ERROR_CODES.enum, { allowed: POINT_SOURCES });
    }
  }

  const hasPoint = checkPoint(location.coordinates, refuse);
  if (!countryCodeFits(location, storedLocation, hasPoint)) {
    refuse(".address.country_code", ERROR_CODES.format);
  }
  return { errors, hasPoint };
}

/**
 * Whether the country code has its form: none, or two letters. An empty
 * one passes only in an empty location (no content, no point) or as the
 * stored one: stored locations are never rewritten.
 */
function countryCodeFits(location, storedLocation, hasPoint) {
  const code = isPlainObject(location.address)
    ? location.address.country_code
    : undefined;
  if (isAbsent(code)) {
    return true;
  }
  if (code === "") {
    const empty = !hasPoint && !hasContent(location);
    const stored = isPlainObject(storedLocation)
      ? storedLocation.address?.country_code
      : undefined;
    return empty || stored === "";
  }
  return typeof code === "string" && COUNTRY_CODE.test(code);
}

/**
 * Checks `coordinates`, the point as `{ type: "Point", points: [lon, lat] }`.
 * Missing coordinates and `points: [null, null]` mean no point.
 *
 * @returns {boolean} Whether the location has a valid point
 */
function checkPoint(coordinates, refuse) {
  if (isAbsent(coordinates)) {
    return false;
  }
  if (!isPlainObject(coordinates)) {
    refuse(".coordinates", INVALID_TYPE_OBJECT);
    return false;
  }
  if (!isAbsent(coordinates.type) && coordinates.type !== "Point") {
    refuse(".coordinates.type", ERROR_CODES.enum, { allowed: ["Point"] });
  }

  const { points } = coordinates;
  if (isAbsent(points)) {
    return false;
  }
  if (!Array.isArray(points) || points.length !== 2) {
    refuse(".coordinates", ERROR_CODES.format);
    return false;
  }
  const [lon, lat] = points;
  if (isAbsent(lon) && isAbsent(lat)) {
    return false;
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    refuse(".coordinates", ERROR_CODES.type_number);
    return false;
  }
  const outside = [
    { axis: "longitude", value: lon, limit: 180 },
    { axis: "latitude", value: lat, limit: 90 },
  ].find(({ value, limit }) => Math.abs(value) > limit);
  if (outside) {
    refuse(
      ".coordinates",
      outside.value > 0 ? ERROR_CODES.max : ERROR_CODES.min,
      { axis: outside.axis, min: -outside.limit, max: outside.limit },
    );
    return false;
  }
  return true;
}

/**
 * Guards the location (glossary "Standort") of a bookable, an event or an
 * access point when the API creates or changes it. Other writers, such as
 * the media import, do not change the location and are not checked.
 *
 * - A location the same as the stored one passes and is stored as it was,
 *   also an old one without a point or given as text only.
 * - An empty location passes: `null`, the default with empty fields and
 *   `points: [null, null]`, or an object without address, addition and point.
 * - A new or changed location with an address, a display text or an addition
 *   needs a point; a point alone is enough.
 * - The known fields have their form; unknown ones stay and are not checked.
 *   An empty country code is a form only in an empty location or as stored.
 */
class LocationGuard {
  /**
   * @param {*} location The location the write would store
   * @param {*} [storedLocation] The stored location of the same thing, none
   *   when it is created
   * @returns {*} The location to store: the stored one when nothing changed
   * @throws {ValidationError} One entry per refused field, e.g.
   *   `location.coordinates`
   */
  static storable(location, storedLocation = null) {
    if (sameContent(location, storedLocation)) {
      return storedLocation;
    }
    if (isAbsent(location)) {
      return location;
    }
    if (typeof location === "string") {
      if (hasContent(location)) {
        throw new ValidationError([pointRequired()]);
      }
      return location;
    }
    if (!isPlainObject(location)) {
      throw new ValidationError([
        { field: "location", code: INVALID_TYPE_OBJECT, params: {} },
      ]);
    }

    const { errors, hasPoint } = checkShape(location, storedLocation);
    const pointRefused = errors.some((e) => e.field === "location.coordinates");
    if (!hasPoint && !pointRefused && hasContent(location)) {
      errors.push(pointRequired());
    }
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    return location;
  }
}

/** The refusal of content without a point: the point is what is missing. */
const pointRequired = () => ({
  field: "location.coordinates",
  code: ERROR_CODES.required,
  params: {},
});

module.exports = LocationGuard;
