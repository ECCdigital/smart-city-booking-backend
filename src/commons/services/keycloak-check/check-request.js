/**
 * The body of `POST /api/instances/keycloak/check`: the mode and the
 * addresses the setup guide shows. Values from the body only ever go to
 * Keycloak as query or form parameters and as the `Origin` header, never as
 * an address to request; still each one is held to the contract here. A
 * refused body is a `ValidationError` (`400`, `details[]` with `field` as a
 * JSON path into the body and a code of `SchemaUtils.ERROR_CODES`).
 */

const { ValidationError } = require("../../../errors/ValidationError");

const MODES = Object.freeze(["bff", "direct"]);
const APPS = Object.freeze(["adminUi", "storefront"]);
const MAX_APPS = 10;
const MAX_URIS = 10;
const MAX_LENGTH = 2048;

/** Whether a value is missing, the way `SchemaUtils` reads `required`. */
function isMissing(value) {
  return value === undefined || value === null || value === "";
}

/**
 * An absolute http(s) URL, `null` for anything else.
 *
 * @param {string} value The text
 * @returns {?URL} The parsed URL
 */
function httpUrlOf(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return ["http:", "https:"].includes(url.protocol) && url.host ? url : null;
}

/**
 * Collects the faults of one body, each with the JSON path of its field.
 */
class CheckRequestFaults {
  constructor() {
    this.details = [];
  }

  add(field, code, params) {
    this.details.push(params ? { field, code, params } : { field, code });
  }

  /**
   * Checks a string: present, a string, at most 2048 characters.
   *
   * @returns {boolean} Whether the value is a string to read further
   */
  string(field, value) {
    if (isMissing(value)) {
      this.add(field, "required");
    } else if (typeof value !== "string") {
      this.add(field, "invalid_type_string");
    } else if (value.length > MAX_LENGTH) {
      this.add(field, "max_length", { max: MAX_LENGTH });
    } else {
      return true;
    }
    return false;
  }

  /**
   * Checks a list: present, an array, at most `max` entries.
   *
   * @returns {boolean} Whether the entries are to be read
   */
  list(field, value, max) {
    if (value === undefined || value === null) {
      this.add(field, "required");
    } else if (!Array.isArray(value)) {
      this.add(field, "invalid_type_array");
    } else if (value.length > max) {
      this.add(field, "max_items", { max });
    } else {
      return true;
    }
    return false;
  }

  /** An Adresse: an absolute http(s) origin, nothing after the port. */
  origin(field, value) {
    if (!this.string(field, value)) return;
    if (httpUrlOf(value)?.origin !== value) this.add(field, "invalid_format");
  }

  /**
   * A list of absolute http(s) URLs; a trailing `*` (the entry of
   * „Benutzer wechseln“) only where `wildcard` allows it.
   */
  uris(field, value, { wildcard }) {
    if (!this.list(field, value, MAX_URIS)) return;
    value.forEach((uri, index) => {
      const entry = `${field}[${index}]`;
      if (!this.string(entry, uri)) return;
      const address = wildcard && uri.endsWith("*") ? uri.slice(0, -1) : uri;
      if (address.endsWith("*") || !httpUrlOf(address)) {
        this.add(entry, "invalid_format");
      }
    });
  }

  /** One entry of `apps`. */
  app(field, entry) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      this.add(field, "invalid_format");
      return;
    }
    if (isMissing(entry.app)) {
      this.add(`${field}.app`, "required");
    } else if (!APPS.includes(entry.app)) {
      this.add(`${field}.app`, "invalid_enum", { allowed: APPS });
    }
    this.origin(`${field}.origin`, entry.origin);
    this.uris(`${field}.redirectUris`, entry.redirectUris, {
      wildcard: false,
    });
    this.uris(`${field}.postLogoutRedirectUris`, entry.postLogoutRedirectUris, {
      wildcard: true,
    });
  }
}

/**
 * Parses the body.
 *
 * @param {Object} body The request body
 * @returns {{mode: string, apps: Object[]}} The request, known fields only
 * @throws {ValidationError} With every fault found
 */
function parseCheckRequest(body) {
  const faults = new CheckRequestFaults();
  const { mode, apps } = body || {};

  if (isMissing(mode)) {
    faults.add("mode", "required");
  } else if (!MODES.includes(mode)) {
    faults.add("mode", "invalid_enum", { allowed: MODES });
  }

  if (faults.list("apps", apps, MAX_APPS)) {
    apps.forEach((entry, index) => faults.app(`apps[${index}]`, entry));
    if (apps.filter((entry) => entry?.app === "storefront").length > 1) {
      faults.add("apps", "max_items", { app: "storefront", max: 1 });
    }
  }

  if (faults.details.length > 0) throw new ValidationError(faults.details);

  return {
    mode,
    apps: apps.map((entry) => ({
      app: entry.app,
      origin: entry.origin,
      redirectUris: [...entry.redirectUris],
      postLogoutRedirectUris: [...entry.postLogoutRedirectUris],
    })),
  };
}

module.exports = { parseCheckRequest };
