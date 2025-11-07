const JwtHelper = require('./jwt-helper');

const authenticateIfNeeded = (req, condition) => {
  if (!condition) return null;

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Access token required');
  }

  const token = authHeader.substring(7);
  return JwtHelper.verifyToken(token);
};

module.exports = { authenticateIfNeeded };