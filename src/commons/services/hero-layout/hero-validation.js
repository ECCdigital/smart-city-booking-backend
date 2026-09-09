const { ValidationError } = require("../../../errors/ValidationError");

/**
 * The error side of the Hero Layout normalisers. Everything the Hero validates
 * — the Background here, the layout and its Blocks in the tickets that follow —
 * answers in the one shape of the Shared contract: a `ValidationError` whose
 * `details[].field` is a JSON path into the request body, so the editor can put
 * the message at the control that carries the fault.
 *
 * The normalisers collect rather than throw at the first fault: an admin who
 * saves a Background with two bad hex values should see both, not one after the
 * other.
 */

/**
 * The path of a key below an object path — `background` + `light` reads
 * `background.light`.
 *
 * @param {string} base - Path of the object.
 * @param {string} key - Key inside it.
 * @returns {string} The JSON path of the key.
 */
function childPath(base, key) {
  return `${base}.${key}`;
}

/**
 * The details of one validation run, in the order the faults were found —
 * which is the order the input was walked in, so the messages arrive in the
 * order the fields stand in the form.
 */
class HeroValidationErrors {
  constructor() {
    this.details = [];
  }

  /**
   * Records one fault.
   *
   * @param {string} field - JSON path into the request body.
   * @param {string} code - A code of the Shared contract's error vocabulary,
   *   taken from `SchemaUtils.ERROR_CODES`.
   * @param {Object} [params] - What the code needs to be understood, e.g. the
   *   allowed values of an enum. Left out when empty.
   */
  add(field, code, params) {
    this.details.push(
      params && Object.keys(params).length > 0
        ? { field, code, params }
        : { field, code },
    );
  }

  /**
   * @returns {boolean} Whether anything was recorded.
   */
  hasErrors() {
    return this.details.length > 0;
  }

  /**
   * Ends the run: nothing happens while it is clean.
   *
   * @throws {ValidationError} With every detail recorded so far.
   */
  throwIfAny() {
    if (this.hasErrors()) {
      throw new ValidationError(this.details);
    }
  }
}

module.exports = {
  HeroValidationErrors,
  childPath,
};
