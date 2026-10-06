const { BadRequestError } = require("../../../errors/BaseError");

/**
 * The optional reason of a supervision action (level change, review
 * decision) as it is stored: a trimmed string, or null for none.
 *
 * @param {*} reason
 * @param {string} invalidCode The error code for a reason that is no string
 * @returns {string|null}
 * @throws {BadRequestError}
 */
function normalizeReason(reason, invalidCode) {
  if (reason === undefined || reason === null) {
    return null;
  }
  if (typeof reason !== "string") {
    throw new BadRequestError(invalidCode);
  }
  const trimmed = reason.trim();
  return trimmed === "" ? null : trimmed;
}

module.exports = { normalizeReason };
