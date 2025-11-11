const bunyan = require('bunyan');
const { TokenSessionModel } = require('../schemas/tokenSessionSchema');

const logger = bunyan.createLogger({
  name: 'token-session-service',
  level: process.env.LOG_LEVEL || 'info'
});

class TokenSessionService {

  static async createSession(sessionData) {
    try {
      const session = new TokenSessionModel({
        jti: sessionData.jti,
        userId: sessionData.userId,
        tokenType: sessionData.tokenType,
        status: 'active',
        issuedAt: sessionData.issuedAt,
        expiresAt: sessionData.expiresAt,
        deviceId: sessionData.deviceId || null,
      });

      await session.save();
      logger.debug(`Token session created for user ${sessionData.userId}`, { jti: sessionData.jti });
      return session;
    } catch (error) {
      logger.error('Error creating token session:', error);
      throw error;
    }
  }

  static async isBlacklisted(jti) {
    try {
      const session = await TokenSessionModel.findOne({
        jti,
        status: 'revoked'
      }).lean();

      return session !== null;
    } catch (error) {
      logger.error('Error checking blacklist:', error);
      return false;
    }
  }


  static async addToBlacklist(jti, reason = 'logout') {
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

      logger.warn(`Token session ${jti} not found, creating revoked entry`);
      return false;
    } catch (error) {
      logger.error('Error adding token to blacklist:', error);
      throw error;
    }
  }


  static async revokeAllUserTokens(userId, reason = 'security') {
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
}

module.exports = TokenSessionService;

