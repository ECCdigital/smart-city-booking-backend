const { isEmail } = require("validator");

/**
 * Parse a string of comma- or newline-separated emails
 * into a deduplicated, trimmed array.
 *
 * @param {string} raw - Raw mail field value
 * @returns {string[]} Parsed email addresses
 */
function parseEmails(raw) {
  if (!raw || typeof raw !== "string") return [];

  return [
    ...new Set(
      raw
        .split(/[,\n]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && isEmail(e)),
    ),
  ];
}

/**
 * Get the primary (first) email address.
 *
 * @param {string} raw - Raw mail field value
 * @returns {string|null}
 */
function getPrimaryEmail(raw) {
  const emails = parseEmails(raw);
  return emails[0] ?? null;
}

module.exports = { parseEmails, getPrimaryEmail };
