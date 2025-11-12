const bunyan = require('bunyan');
const JwtHelper = require('../commons/utilities/jwt-helper');
const UserManager = require('../commons/data-managers/user-manager');

const logger = bunyan.createLogger({
  name: 'auth-middleware',
  level: process.env.LOG_LEVEL || 'info'
});

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = JwtHelper.extractToken(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = JwtHelper.verifyToken(token); // Nicht mehr async

    const user = await UserManager.getUser(decoded.sub);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: 'User account is suspended'
      });
    }

    req.user = {
      id: decoded.sub,
      jti: decoded.jti || null,
      tokenVersion: decoded.v,
      isLegacy: decoded.isLegacy || false,
    };

    next();
  } catch (error) {
    logger.error('Authentication failed:', error.message);

    let message = 'Invalid or expired token';
    if (error.message === 'Token has been revoked') {
      message = 'Token has been revoked';
    } else if (error.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid token';
    }

    return res.status(401).json({
      success: false,
      message
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const token = JwtHelper.extractToken(authHeader);

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = JwtHelper.verifyToken(token);

    const user = await UserManager.getUser(decoded.sub);
    if (!user) {
      req.user = null;
      return next();
    }

    if (user.isSuspended) {
      req.user = null;
      return next();
    }

    req.user = {
      id: decoded.sub,
      jti: decoded.jti || null,
      tokenVersion: decoded.v,
      isLegacy: decoded.isLegacy || false,
    };

    next();
  } catch (error) {
    logger.debug('Optional auth failed, continuing without user:', error.message);
    req.user = null;
    next();
  }
};


const conditionalAuth = (conditionFn) => {
  return async (req, res, next) => {
    const requiresAuth = await conditionFn(req);

    if (requiresAuth) {
      return requireAuth(req, res, next);
    } else {
      return optionalAuth(req, res, next);
    }
  };
};

module.exports = {
  requireAuth,
  optionalAuth,
  conditionalAuth,
};

