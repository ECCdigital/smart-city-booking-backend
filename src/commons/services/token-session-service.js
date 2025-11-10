const bunyan = require('bunyan');
const { TokenSessionModel } = require('../schemas/tokenSessionSchema');

const logger = bunyan.createLogger({
  name: 'token-session-service',
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Service für Token-Session-Verwaltung in MongoDB
 * Ersetzt Redis-basierte Blacklist
 */
class TokenSessionService {
  /**
   * Erstellt eine neue Token-Session
   * @param {Object} sessionData - Session-Daten
   * @returns {Promise<Object>}
   */
  async createSession(sessionData) {
    try {
      const session = new TokenSessionModel({
        jti: sessionData.jti,
        userId: sessionData.userId,
        tokenType: sessionData.tokenType,
        status: 'active',
        issuedAt: sessionData.issuedAt,
        expiresAt: sessionData.expiresAt,
        ipAddress: sessionData.ipAddress || null,
        userAgent: sessionData.userAgent || null,
        deviceId: sessionData.deviceId || null,
        metadata: sessionData.metadata || {},
      });

      await session.save();
      logger.debug(`Token session created for user ${sessionData.userId}`, { jti: sessionData.jti });
      return session;
    } catch (error) {
      logger.error('Error creating token session:', error);
      throw error;
    }
  }

  /**
   * Prüft ob ein Token auf der Blacklist (revoked) ist
   * @param {string} jti - JWT ID
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(jti) {
    try {
      const session = await TokenSessionModel.findOne({
        jti,
        status: 'revoked'
      }).lean();

      return session !== null;
    } catch (error) {
      logger.error('Error checking blacklist:', error);
      // Im Fehlerfall: Token als nicht-blacklisted behandeln (fail-open)
      // Alternative: fail-closed -> return true
      return false;
    }
  }

  /**
   * Fügt einen Token zur Blacklist hinzu (revoked)
   * @param {string} jti - JWT ID
   * @param {string} reason - Grund für Revocation
   * @returns {Promise<boolean>}
   */
  async addToBlacklist(jti, reason = 'logout') {
    try {
      const result = await TokenSessionModel.updateOne(
        { jti },
        {
          $set: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: reason
          }
        },
        { upsert: false }
      );

      if (result.modifiedCount > 0) {
        logger.info(`Token ${jti} added to blacklist`, { reason });
        return true;
      }

      // Wenn Session nicht existiert, erstelle sie als revoked
      // (für Tokens die vor der Implementierung erstellt wurden)
      logger.warn(`Token session ${jti} not found, creating revoked entry`);
      return false;
    } catch (error) {
      logger.error('Error adding token to blacklist:', error);
      throw error;
    }
  }

  /**
   * Invalidiert alle aktiven Tokens eines Users
   * @param {string} userId - User ID
   * @param {string} reason - Grund für Revocation
   * @returns {Promise<number>} Anzahl invalidierter Tokens
   */
  async revokeAllUserTokens(userId, reason = 'security') {
    try {
      const result = await TokenSessionModel.updateMany(
        { userId, status: 'active' },
        {
          $set: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: reason
          }
        }
      );

      logger.info(`Revoked ${result.modifiedCount} tokens for user ${userId}`, { reason });
      return result.modifiedCount;
    } catch (error) {
      logger.error('Error revoking all user tokens:', error);
      throw error;
    }
  }

  /**
   * Holt alle aktiven Sessions eines Users
   * @param {string} userId - User ID
   * @returns {Promise<Array>}
   */
  async getUserActiveSessions(userId) {
    try {
      const sessions = await TokenSessionModel.find({
        userId,
        status: 'active',
        expiresAt: { $gt: new Date() }
      })
      .sort({ issuedAt: -1 })
      .lean();

      return sessions;
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Invalidiert eine spezifische Session
   * @param {string} sessionId - Session ID (_id oder jti)
   * @param {string} userId - User ID (für Security)
   * @returns {Promise<boolean>}
   */
  async revokeSession(sessionId, userId) {
    try {
      const result = await TokenSessionModel.updateOne(
        {
          $or: [{ _id: sessionId }, { jti: sessionId }],
          userId,
          status: 'active'
        },
        {
          $set: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: 'user_action'
          }
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Error revoking session:', error);
      throw error;
    }
  }

  /**
   * Löscht abgelaufene Token-Sessions (Cleanup)
   * TTL-Index macht das automatisch, aber für manuelle Cleanup
   * @returns {Promise<number>} Anzahl gelöschter Sessions
   */
  async cleanupExpiredSessions() {
    try {
      const result = await TokenSessionModel.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      logger.info(`Cleaned up ${result.deletedCount} expired sessions`);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error cleaning up expired sessions:', error);
      return 0;
    }
  }

  /**
   * Gibt Statistiken über Token-Sessions zurück
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const [activeCount, revokedCount, totalCount] = await Promise.all([
        TokenSessionModel.countDocuments({ status: 'active', expiresAt: { $gt: new Date() } }),
        TokenSessionModel.countDocuments({ status: 'revoked' }),
        TokenSessionModel.countDocuments({}),
      ]);

      return {
        active: activeCount,
        revoked: revokedCount,
        total: totalCount,
        expired: totalCount - activeCount - revokedCount,
      };
    } catch (error) {
      logger.error('Error getting stats:', error);
      return { active: 0, revoked: 0, total: 0, expired: 0 };
    }
  }

  /**
   * Prüft ob eine Session existiert
   * @param {string} jti - JWT ID
   * @returns {Promise<Object|null>}
   */
  async getSession(jti) {
    try {
      return await TokenSessionModel.findOne({ jti }).lean();
    } catch (error) {
      logger.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Entfernt einen Token von der Blacklist (für Tests)
   * @param {string} jti - JWT ID
   */
  async removeFromBlacklist(jti) {
    try {
      const result = await TokenSessionModel.deleteOne({ jti });
      logger.info(`Token ${jti} removed from database`);
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Error removing token from blacklist:', error);
      throw error;
    }
  }
}

// Singleton Instance
const tokenSessionService = new TokenSessionService();

module.exports = tokenSessionService;

