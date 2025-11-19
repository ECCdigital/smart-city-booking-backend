const JwtHelper = require('./jwt-helper');

/**
 * Authenticate request if condition is met
 * @param {Object} req - Express Request
 * @param {boolean} condition - If true, authentication is performed
 * @returns {Promise<Object|null>} - Decoded token or null
 */
const authenticateIfNeeded = async (req, condition) => {
  if (!condition) return null;

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Access token required');
  }

  const token = authHeader.substring(7);
  return await JwtHelper.verifyToken(token);
};

module.exports = { authenticateIfNeeded };