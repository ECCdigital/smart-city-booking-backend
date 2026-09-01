/**
 * Escapes a user supplied term so it can be used literally inside a RegExp.
 *
 * @param {*} value - The raw term.
 * @returns {string} The escaped term.
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { escapeRegex };
