const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const TokenSessionService = require("../services/token-session-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "jwt-helper",
  level: process.env.LOG_LEVEL || "info",
});

class JwtHelper {
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

  static extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.substring(7);
  }
}

module.exports = JwtHelper;
