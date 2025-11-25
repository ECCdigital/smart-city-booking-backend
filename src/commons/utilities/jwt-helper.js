const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const TokenSessionService = require("../services/token-session-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "jwt-helper",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * A helper class for managing JSON Web Tokens (JWTs).
 * Provides methods for generating, verifying, and revoking access and refresh tokens.
 */
class JwtHelper {

  /**
   * Generates an access token for a user.
   *
   * @param {Object} user - The user object for whom the token is generated.
   * @param {string} user.id - The unique identifier of the user.
   * @param {Object} [context={}] - Additional context for token generation.
   * @returns {string} The generated access token.
   */
  static generateToken(user, context = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiry(process.env.JWT_EXPIRES_IN || "15m");

    const payload = {
      sub: user.id,
      iss: process.env.JWT_ISSUER || "smart-city-booking",
      aud: process.env.JWT_AUDIENCE || "smart-city-api",
      iat: now,
      exp: now + expiresIn,
      nbf: now,
      type: "access",
      v: 2,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      algorithm: process.env.JWT_ALGORITHM || "HS256",
    });

    logger.debug(`Access token generated for user ${user.id} (no DB tracking)`);

    return token;
  }

  /**
   * Generates a refresh token for a user and creates a corresponding session in the database.
   *
   * @param {Object} user - The user object for whom the refresh token is generated.
   * @param {string} user.id - The unique identifier of the user.
   * @param {Object} [context={}] - Additional context for token generation, such as device information.
   * @returns {Promise<string>} The generated refresh token.
   * @throws {Error} If an error occurs while creating the token session in the database.
   */
  static async generateRefreshToken(user, context = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiry(
      process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    );

    const payload = {
      jti: uuidv4(),
      sub: user.id,
      iss: process.env.JWT_ISSUER || "smart-city-booking",
      aud: process.env.JWT_AUDIENCE || "smart-city-api",
      iat: now,
      exp: now + expiresIn,
      nbf: now,
      type: "refresh",
      v: 2,
    };

    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      algorithm: process.env.JWT_ALGORITHM || "HS256",
    });

    try {
      await TokenSessionService.createSession({
        jti: payload.jti,
        userId: user.id,
        tokenType: "refresh",
        issuedAt: new Date(now * 1000),
        expiresAt: new Date(payload.exp * 1000),
        deviceId: context.deviceId,
      });
    } catch (error) {
      logger.error("Error creating refresh token session:", error);
    }

    logger.debug(`Refresh token generated for user ${user.id}`, {
      jti: payload.jti,
    });

    return token;
  }

  /**
   * Verifies the validity of an access token.
   *
   * @param {string} token - The JWT access token to verify.
   * @returns {Object} The decoded token payload if verification is successful.
   * @throws {Error} If the token is invalid, expired, or fails verification.
   */
  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER || "smart-city-booking",
        audience: process.env.JWT_AUDIENCE || "smart-city-api",
      });

      if (!decoded.v || decoded.v < 2) {
        throw new Error(
          "Token version no longer supported - please login again",
        );
      }

      if (decoded.type !== "access") {
        throw new Error("Invalid token type");
      }

      return decoded;
    } catch (error) {
      logger.error("Token verification failed:", error.message);
      throw error;
    }
  }

  /**
   * Verifies the validity of a refresh token.
   *
   * @param {string} token - The JWT refresh token to verify.
   * @returns {Promise<Object>} The decoded token payload if verification is successful.
   * @throws {Error} If the token is invalid, expired, revoked, or fails verification.
   */
  static async verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
        issuer: process.env.JWT_ISSUER || "smart-city-booking",
        audience: process.env.JWT_AUDIENCE || "smart-city-api",
      });

      if (decoded.type !== "refresh") {
        throw new Error("Invalid token type");
      }

      if (decoded.jti) {
        const isBlacklisted = await TokenSessionService.isBlacklisted(
          decoded.jti,
        );
        if (isBlacklisted) {
          throw new Error("Refresh token has been revoked");
        }
      }

      return decoded;
    } catch (error) {
      logger.error("Refresh token verification failed:", error.message);
      throw error;
    }
  }

  /**
   * Revokes a token by adding it to the blacklist.
   *
   * @param {string} token - The JWT token to revoke.
   * @param {string} [reason="logout"] - The reason for revoking the token.
   * @returns {Promise<boolean>} `true` if the token was successfully revoked, otherwise `false`.
   * @throws {Error} If an error occurs during the revocation process.
   */
  static async revokeToken(token, reason = "logout") {
    try {
      const decoded = jwt.decode(token);

      if (!decoded) {
        logger.warn("Cannot revoke token - invalid token");
        return false;
      }

      if (decoded.type === "access") {
        logger.debug(
          "Access token revocation skipped - tokens expire automatically",
        );
        return true;
      }

      if (!decoded.jti) {
        logger.warn("Cannot revoke refresh token without JTI");
        return false;
      }

      const success = await TokenSessionService.addToBlacklist(
        decoded.jti,
        reason,
      );

      if (success) {
        logger.info(`Refresh token revoked for user ${decoded.sub}`, {
          jti: decoded.jti,
          reason,
        });
      }

      return success;
    } catch (error) {
      logger.error("Error revoking token:", error);
      throw error;
    }
  }

  /**
   * Revokes all refresh tokens for a specific user by marking them as blacklisted.
   *
   * @param {string} userId - The unique identifier of the user whose tokens are to be revoked.
   * @param {string} [reason="security"] - The reason for revoking the tokens.
   * @returns {Promise<number>} The number of tokens that were successfully revoked.
   * @throws {Error} If an error occurs during the revocation process.
   */
  static async revokeAllUserTokens(userId, reason = "security") {
    try {
      const count = await TokenSessionService.revokeAllUserTokens(
        userId,
        reason,
      );
      logger.info(`Revoked ${count} refresh tokens for user ${userId}`, {
        reason,
      });
      return count;
    } catch (error) {
      logger.error("Error revoking all user tokens:", error);
      throw error;
    }
  }

  /**
   * Parses an expiry string and converts it into seconds.
   *
   * @param {string} expiry - The expiry duration in the format of `<number><unit>`,
   *                          where `unit` can be `s` (seconds), `m` (minutes),
   *                          `h` (hours), or `d` (days).
   * @returns {number} The expiry duration in seconds.
   * @throws {Error} If the expiry format is invalid.
   */
  static parseExpiry(expiry) {
    const units = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      logger.warn(`Invalid expiry format: ${expiry}, defaulting to 15m`);
      return 900;
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }

  /**
   * Extracts the token from an authorization header.
   *
   * @param {string} authHeader - The authorization header string, expected to start with "Bearer ".
   * @returns {string|null} The extracted token if the header is valid, otherwise `null`.
   */
  static extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.substring(7);
  }
}

module.exports = JwtHelper;
