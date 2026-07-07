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

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Access token required");
  }

  const token = JwtHelper.extractToken(authHeader);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

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

    return user;
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

    return user;
  }
};

module.exports = { authenticateIfNeeded };
