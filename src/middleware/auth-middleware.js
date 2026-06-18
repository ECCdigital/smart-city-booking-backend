const bunyan = require("bunyan");
const JwtHelper = require("../commons/utilities/jwt-helper");
const KeycloakVerifier = require("../commons/utilities/keycloak-verifier");
const UserManager = require("../commons/data-managers/user-manager");

const logger = bunyan.createLogger({
  name: "auth-middleware",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Bestimmt anhand des Token-Payloads, ob es ein Keycloak-
 * oder ein lokales Token ist.
 */
function classifyToken(decoded) {
  // Keycloak-Tokens haben typischerweise "realm_access",
  // "azp" (authorized party) und der Issuer enthält "/realms/"
  if (
    decoded.azp ||
    decoded.realm_access ||
    (decoded.iss && decoded.iss.includes("/realms/"))
  ) {
    return "keycloak";
  }
  return "local";
}

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = JwtHelper.extractToken(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    const jwt = require("jsonwebtoken");
    const unverified = jwt.decode(token);

    if (!unverified) {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    const tokenType = classifyToken(unverified);

    if (tokenType === "keycloak") {
      const decoded = await KeycloakVerifier.verifyToken(token);

      let user;
      try {
        user = await UserManager.resolveKeycloakUser(decoded);
      } catch (error) {
        if (error.status === 404) {
          return res.status(401).json({
            success: false,
            message: "User not found in local system",
          });
        }
        throw error;
      }

      if (user.isSuspended) {
        return res.status(403).json({
          success: false,
          message: "User account is suspended",
        });
      }

      req.user = {
        id: user.id,
        authType: "keycloak",
        keycloakSub: decoded.sub,
        jti: decoded.jti || null,
        tokenVersion: null,
        isLegacy: false,
      };
    } else {
      const decoded = JwtHelper.verifyToken(token);

      const user = await UserManager.getUser(decoded.sub);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.isSuspended) {
        return res.status(403).json({
          success: false,
          message: "User account is suspended",
        });
      }

      req.user = {
        id: decoded.sub,
        authType: "local",
        jti: decoded.jti || null,
        tokenVersion: decoded.v,
        isLegacy: decoded.isLegacy || false,
      };
    }

    next();
  } catch (error) {
    logger.error("Authentication failed:", error.message);

    let message = "Invalid or expired token";
    if (error.message === "Token has been revoked") {
      message = "Token has been revoked";
    } else if (error.name === "TokenExpiredError") {
      message = "Token has expired";
    } else if (error.name === "JsonWebTokenError") {
      message = "Invalid token";
    } else if (error.message?.includes("Keycloak")) {
      message = "SSO token verification failed";
    }

    return res.status(401).json({
      success: false,
      message,
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

    const jwt = require("jsonwebtoken");
    const unverified = jwt.decode(token);

    if (!unverified) {
      req.user = null;
      return next();
    }

    const tokenType = classifyToken(unverified);

    if (tokenType === "keycloak") {
      const decoded = await KeycloakVerifier.verifyToken(token);

      let user;
      try {
        user = await UserManager.resolveKeycloakUser(decoded);
      } catch {
        req.user = null;
        return next();
      }

      if (user.isSuspended) {
        req.user = null;
        return next();
      }

      req.user = {
        id: user.id,
        authType: "keycloak",
        keycloakSub: decoded.sub,
        jti: decoded.jti || null,
        tokenVersion: null,
        isLegacy: false,
      };
    } else {
      const decoded = JwtHelper.verifyToken(token);
      const user = await UserManager.getUser(decoded.sub);

      if (!user || user.isSuspended) {
        req.user = null;
        return next();
      }

      req.user = {
        id: decoded.sub,
        authType: "local",
        jti: decoded.jti || null,
        tokenVersion: decoded.v,
        isLegacy: decoded.isLegacy || false,
      };
    }

    next();
  } catch (error) {
    logger.debug(
      "Optional auth failed, continuing without user:",
      error.message,
    );
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
