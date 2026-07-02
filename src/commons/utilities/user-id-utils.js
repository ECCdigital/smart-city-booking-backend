/**
 * Normalize a user identifier (email) for storage and comparison.
 * @param {string} userId
 * @returns {string}
 */
function normalizeUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

/**
 * Case-insensitive comparison of two user identifiers.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function userIdsMatch(a, b) {
  if (a == null || b == null) return false;
  return normalizeUserId(a) === normalizeUserId(b);
}

module.exports = { normalizeUserId, userIdsMatch };
