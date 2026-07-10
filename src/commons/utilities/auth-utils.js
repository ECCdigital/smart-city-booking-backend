const JwtHelper = require("./jwt-helper");
const KeycloakVerifier = require("./keycloak-verifier");
const jwt = require("jsonwebtoken");
const { classifyToken } = require("./token-classifier");
const UserManager = require("../data-managers/user-manager");

/**
 * Authenticate request if condition is met
 * @param {Object} req - Express Request
 * @param {boolean} condition - If true, authentication is performed
 * @returns {Promise<Object|null>} - Decoded token or null
 */
const authenticateIfNeeded = async (req, condition) => {
  if (!condition) return null;

  const authHeader = req.headers.authorization;
  const token = JwtHelper.extractToken(authHeader);

  if (!token) return null;

  const unverified = jwt.decode(token);
  if (!unverified) return null;

  const tokenType = classifyToken(unverified);

  if (tokenType === "keycloak") {
    const decoded = await KeycloakVerifier.verifyToken(token);

    try {
      const user = await UserManager.resolveKeycloakUser(decoded);
      if (!user || user.isSuspended) return null;

      return {
        id: user.id,
        authType: "keycloak",
        keycloakSub: decoded.sub,
        jti: decoded.jti || null,
        tokenVersion: null,
        isLegacy: false,
      };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  const decoded = JwtHelper.verifyToken(token);
  const user = await UserManager.getUser(decoded.sub);
  if (!user || user.isSuspended) return null;

  return {
    id: decoded.sub,
    authType: "local",
    jti: decoded.jti || null,
    tokenVersion: decoded.v,
    isLegacy: decoded.isLegacy || false,
  };
};

module.exports = { authenticateIfNeeded };
