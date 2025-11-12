const JwtHelper = require('./jwt-helper');

/**
 * Authentifiziert Request falls Bedingung erfüllt ist
 * @param {Object} req - Express Request
 * @param {boolean} condition - Wenn true, wird Token validiert
 * @returns {Promise<Object|null>} Decoded Token oder null
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