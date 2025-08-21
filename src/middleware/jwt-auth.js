const JwtHelper = require('../commons/utilities/jwt-helper');
const bunyan = require('bunyan');

const logger = bunyan.createLogger({ name: 'jwt-auth' });

const jwtAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Access token required' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = JwtHelper.verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = jwtAuth;