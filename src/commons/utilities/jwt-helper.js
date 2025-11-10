const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const tokenSessionService = require('../services/token-session-service');
const bunyan = require('bunyan');

const logger = bunyan.createLogger({
  name: 'jwt-helper',
  level: process.env.LOG_LEVEL || 'info'
});

class JwtHelper {
  /**
   * Generiert einen Access Token OHNE Session-Tracking
   * Access-Tokens werden nur per JWT-Signatur verifiziert, nicht in DB gespeichert
   * @param {Object} user - User Objekt
   * @param {Object} context - Optional: IP, UserAgent, etc. (wird ignoriert für Access-Tokens)
   * @returns {string} JWT Token
   */
  static generateToken(user, context = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiry(process.env.JWT_EXPIRES_IN || '15m');

    const payload = {
      sub: user.id,
      iss: process.env.JWT_ISSUER || 'smart-city-booking',
      aud: process.env.JWT_AUDIENCE || 'smart-city-api',
      iat: now,
      exp: now + expiresIn,
      nbf: now,
      type: 'access',
      v: 2,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET);

    logger.debug(`Access token generated for user ${user.id} (no DB tracking)`);

    return token;
  }

  /**
   * Generiert einen Refresh Token mit Session-Tracking
   * @param {Object} user - User Objekt
   * @param {Object} context - Optional: IP, UserAgent, etc.
   * @returns {Promise<string>} JWT Refresh Token
   */
  static async generateRefreshToken(user, context = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiry(process.env.JWT_REFRESH_EXPIRES_IN || '7d');

    const payload = {
      jti: uuidv4(),
      sub: user.id,
      iss: process.env.JWT_ISSUER || 'smart-city-booking',
      aud: process.env.JWT_AUDIENCE || 'smart-city-api',
      iat: now,
      exp: now + expiresIn,
      nbf: now,
      type: 'refresh',
      v: 2,
    };

    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET);

    // Session in MongoDB speichern
    try {
      await tokenSessionService.createSession({
        jti: payload.jti,
        userId: user.id,
        tokenType: 'refresh',
        issuedAt: new Date(now * 1000),
        expiresAt: new Date(payload.exp * 1000),
        ipAddress: context.ip,
        userAgent: context.userAgent,
        deviceId: context.deviceId,
        metadata: context.metadata || {},
      });
    } catch (error) {
      logger.error('Error creating refresh token session:', error);
    }

    logger.debug(`Refresh token generated for user ${user.id}`, { jti: payload.jti });

    return token;
  }

  /**
   * Verifiziert einen Access Token
   * Access-Tokens werden NUR per JWT-Signatur verifiziert, KEINE Blacklist-Prüfung
   * @param {string} token - JWT Token
   * @returns {Object} Decoded Token
   * @throws {Error} Bei ungültigem Token
   */
  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER || 'smart-city-booking',
        audience: process.env.JWT_AUDIENCE || 'smart-city-api',
      });

      // Prüfe Token-Version
      if (!decoded.v) {
        // Legacy Token (v1) - Migration Mode
        logger.warn(`Legacy token detected for user ${decoded.id || decoded.sub}`);
        return this.handleLegacyToken(decoded);
      }

      // Prüfe Token-Typ
      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      // KEINE Blacklist-Prüfung für Access-Tokens!
      // Access-Tokens laufen nach kurzer Zeit (15min) automatisch ab

      return decoded;
    } catch (error) {
      logger.error('Token verification failed:', error.message);
      throw error;
    }
  }

  /**
   * Verifiziert einen Refresh Token
   * @param {string} token - JWT Refresh Token
   * @returns {Promise<Object>} Decoded Token
   * @throws {Error} Bei ungültigem Token
   */
  static async verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
        issuer: process.env.JWT_ISSUER || 'smart-city-booking',
        audience: process.env.JWT_AUDIENCE || 'smart-city-api',
      });

      // Prüfe Token-Typ
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Prüfe Blacklist in MongoDB
      if (decoded.jti) {
        const isBlacklisted = await tokenSessionService.isBlacklisted(decoded.jti);
        if (isBlacklisted) {
          throw new Error('Refresh token has been revoked');
        }
      }

      return decoded;
    } catch (error) {
      logger.error('Refresh token verification failed:', error.message);
      throw error;
    }
  }

  /**
   * Invalidiert einen Refresh-Token (Logout)
   * Access-Tokens werden NICHT invalidiert (laufen automatisch ab)
   * @param {string} token - JWT Token
   * @param {string} reason - Grund für Revocation
   * @returns {Promise<boolean>}
   */
  static async revokeToken(token, reason = 'logout') {
    try {
      const decoded = jwt.decode(token);

      if (!decoded) {
        logger.warn('Cannot revoke token - invalid token');
        return false;
      }

      // Nur Refresh-Tokens werden revoked
      if (decoded.type === 'access') {
        logger.debug('Access token revocation skipped - tokens expire automatically');
        return true; // Erfolgreich, auch wenn nichts gemacht wurde
      }

      if (!decoded.jti) {
        logger.warn('Cannot revoke refresh token without JTI');
        return false;
      }

      const success = await tokenSessionService.addToBlacklist(decoded.jti, reason);

      if (success) {
        logger.info(`Refresh token revoked for user ${decoded.sub}`, { jti: decoded.jti, reason });
      }

      return success;
    } catch (error) {
      logger.error('Error revoking token:', error);
      throw error;
    }
  }

  /**
   * Invalidiert alle Refresh-Tokens eines Users (bei Passwort-Änderung etc.)
   * Access-Tokens werden NICHT invalidiert (laufen automatisch ab)
   * @param {string} userId - User ID
   * @param {string} reason - Grund für Revocation
   * @returns {Promise<number>} Anzahl invalidierter Refresh-Tokens
   */
  static async revokeAllUserTokens(userId, reason = 'security') {
    try {
      const count = await tokenSessionService.revokeAllUserTokens(userId, reason);
      logger.info(`Revoked ${count} refresh tokens for user ${userId}`, { reason });
      return count;
    } catch (error) {
      logger.error('Error revoking all user tokens:', error);
      throw error;
    }
  }

  /**
   * Behandelt Legacy-Tokens (Backward Compatibility)
   * @private
   */
  static handleLegacyToken(decoded) {
    return {
      jti: null,
      sub: decoded.id,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
      type: 'access',
      v: 1,
      isLegacy: true,
    };
  }

  /**
   * Parst Expiry-String zu Sekunden
   * @private
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
   * Extrahiert Token aus Authorization Header
   */
  static extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }
}

module.exports = JwtHelper;