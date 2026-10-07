const bunyan = require("bunyan");
const JwtHelper = require("../commons/utilities/jwt-helper");
const KeycloakVerifier = require("../commons/utilities/keycloak-verifier");
const UserManager = require("../commons/data-managers/user-manager");

const logger = bunyan.createLogger({
  name: "auth-middleware",
  level: process.env.LOG_LEVEL || "info",
});

const { classifyToken } = require("../commons/utilities/token-classifier");

/**
 * The 401 of a token that fails its verification - expired, revoked or
 * invalid - with the message that names why. Protected and public routes
 * answer it alike, so a client knows to renew its token.
 *
 * @param {import("express").Response} res
 * @param {Error} error - What the verification threw.
 * @returns {import("express").Response} The response, sent.
 */
function refuseToken(res, error) {
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
    return refuseToken(res, error);
  }
};

/**
 * Lets a public route through with or without a user. Without a token the
 * request is anonymous. A token sent along must hold, as on a protected
 * route: an expired, revoked or invalid one is refused with the same 401
 * (`refuseToken`), never taken for anonymous, so the client renews it
 * (ECCdigital/tickets#109). A valid token whose user is unknown or
 * suspended stays anonymous.
 */
const optionalAuth = async (req, res, next) => {
  const token = JwtHelper.extractToken(req.headers.authorization);

  if (!token) {
    req.user = null;
    return next();
  }

  let tokenType;
  let decoded;
  try {
    const jwt = require("jsonwebtoken");
    const unverified = jwt.decode(token);

    if (!unverified) {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    tokenType = classifyToken(unverified);
    decoded =
      tokenType === "keycloak"
        ? await KeycloakVerifier.verifyToken(token)
        : JwtHelper.verifyToken(token);
  } catch (error) {
    logger.debug("Optional auth refused the token:", error.message);
    return refuseToken(res, error);
  }

  try {
    if (tokenType === "keycloak") {
      const user = await UserManager.resolveKeycloakUser(decoded);

      req.user = user.isSuspended
        ? null
        : {
            id: user.id,
            authType: "keycloak",
            keycloakSub: decoded.sub,
            jti: decoded.jti || null,
            tokenVersion: null,
            isLegacy: false,
          };
    } else {
      const user = await UserManager.getUser(decoded.sub);

      req.user =
        !user || user.isSuspended
          ? null
          : {
              id: decoded.sub,
              authType: "local",
              jti: decoded.jti || null,
              tokenVersion: decoded.v,
              isLegacy: decoded.isLegacy || false,
            };
    }
  } catch (error) {
    logger.debug(
      "Optional auth found no user for the token, continuing without:",
      error.message,
    );
    req.user = null;
  }

  next();
};

module.exports = {
  requireAuth,
  optionalAuth,
};
