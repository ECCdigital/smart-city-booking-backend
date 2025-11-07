const bunyan = require('bunyan');
const { authenticateIfNeeded } = require("../commons/utilities/auth-utils");

const logger = bunyan.createLogger({ name: 'jwt-auth' });

const jwtAuth = (req, res, next) => {
  try {
    req.user = authenticateIfNeeded(req, true);
    next();
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = jwtAuth;