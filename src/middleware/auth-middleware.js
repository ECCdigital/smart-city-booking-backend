const bunyan = require('bunyan');
const JwtHelper = require('../commons/utilities/jwt-helper');
const UserManager = require('../commons/data-managers/user-manager');

const logger = bunyan.createLogger({
  name: 'auth-middleware',
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Middleware: Obligatorische Authentifizierung
 * Blockiert Request bei fehlendem/ungültigem Token
 */
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

    // Prüfe ob User noch existiert
    const user = await UserManager.getUser(decoded.sub);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prüfe ob User gesperrt ist
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

/**
 * Middleware: Optionale Authentifizierung
 * Setzt req.user wenn Token vorhanden, blockiert aber nicht
 */
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

/**
 * Middleware Factory: Rollen-basierte Authentifizierung
 * @param {...string} allowedRoles - Erlaubte Rollen
 */
const requireRoles = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const tenantId = req.params.tenant;
      if (!tenantId) {
        logger.warn('requireRoles: No tenant ID in request');
        return res.status(400).json({
          success: false,
          message: 'Tenant ID required'
        });
      }

      const TenantManager = require('../commons/data-managers/tenant-manager');
      const userRoles = await TenantManager.getTenantUserRoles(tenantId, req.user.id);

      const hasRole = userRoles.some(role => allowedRoles.includes(role));

      if (!hasRole) {
        logger.warn(`User ${req.user.id} missing required roles: ${allowedRoles}`);
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions'
        });
      }

      req.user.roles = userRoles;
      next();
    } catch (error) {
      logger.error('Role check failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  };
};

/**
 * Middleware: Conditional Auth basierend auf Bedingung
 * @param {Function} conditionFn - Funktion die true/false zurückgibt
 */
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
  requireRoles,
  conditionalAuth,
};

