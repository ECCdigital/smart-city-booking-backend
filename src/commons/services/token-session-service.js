const bunyan = require("bunyan");
const { TokenSessionModel } = require("../schemas/tokenSessionSchema");

const logger = bunyan.createLogger({
  name: "token-session-service",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Service class for managing token sessions.
 * Provides methods to create, verify, blacklist, and revoke token sessions.
 */
class TokenSessionService {
  /**
   * Creates a new token session in the database.
   *
   * @param {Object} sessionData - The data for the token session to be created.
   * @param {string} sessionData.jti - The unique identifier for the token.
   * @param {string} sessionData.userId - The ID of the user associated with the token.
   * @param {string} sessionData.tokenType - The type of the token (e.g., access, refresh).
   * @param {string} sessionData.status - The status of the token session (default: 'active').
   * @param {Date} sessionData.issuedAt - The timestamp when the token was issued.
   * @param {Date} sessionData.expiresAt - The timestamp when the token will expire.
   * @param {string} [sessionData.deviceId] - Optional device identifier associated with the session.
   *
   * @returns {Promise<Object>} The created token session document.
   * @throws {Error} If an error occurs while saving the session to the database.
   */
  static async createSession(sessionData) {
    try {
      const session = new TokenSessionModel({
        jti: sessionData.jti,
        userId: sessionData.userId,
        tokenType: sessionData.tokenType,
        status: "active",
        issuedAt: sessionData.issuedAt,
        expiresAt: sessionData.expiresAt,
        deviceId: sessionData.deviceId || null,
      });

      await session.save();
      logger.debug(`Token session created for user ${sessionData.userId}`, {
        jti: sessionData.jti,
      });
      return session;
    } catch (error) {
      logger.error("Error creating token session:", error);
      throw error;
    }
  }

  /**
   * Checks if a token is blacklisted (revoked).
   *
   * @param {string} jti - The unique identifier of the token to check.
   * @returns {Promise<boolean>} True if the token is blacklisted, false otherwise.
   * @throws {Error} If an error occurs while querying the database.
   */
  static async isBlacklisted(jti) {
    try {
      const session = await TokenSessionModel.findOne({
        jti,
        status: "revoked",
      }).lean();

      return session !== null;
    } catch (error) {
      logger.error("Error checking blacklist:", error);
      return false;
    }
  }

  /**
   * Adds a token to the blacklist by marking it as revoked in the database.
   *
   * @param {string} jti - The unique identifier of the token to blacklist.
   * @param {string} [reason='logout'] - The reason for revoking the token (default: 'logout').
   * @returns {Promise<boolean>} True if the token was successfully blacklisted, false otherwise.
   * @throws {Error} If an error occurs while updating the database.
   */
  static async addToBlacklist(jti, reason = "logout") {
    try {
      const result = await TokenSessionModel.updateOne(
        { jti },
        {
          $set: {
            status: "revoked",
            revokedAt: new Date(),
            revokeReason: reason,
          },
        },
        { upsert: false },
      );

      if (result.modifiedCount > 0) {
        logger.info(`Token ${jti} added to blacklist`, { reason });
        return true;
      }

      logger.warn(`Token session ${jti} not found, creating revoked entry`);
      return false;
    } catch (error) {
      logger.error("Error adding token to blacklist:", error);
      throw error;
    }
  }

  /**
   * Revokes all active tokens for a specific user by marking them as revoked in the database.
   *
   * @param {string} userId - The ID of the user whose tokens should be revoked.
   * @param {string} [reason='security'] - The reason for revoking the tokens (default: 'security').
   * @returns {Promise<number>} The number of tokens that were successfully revoked.
   * @throws {Error} If an error occurs while updating the database.
   */
  static async revokeAllUserTokens(userId, reason = "security") {
    try {
      const result = await TokenSessionModel.updateMany(
        { userId, status: "active" },
        {
          $set: {
            status: "revoked",
            revokedAt: new Date(),
            revokeReason: reason,
          },
        },
      );

      logger.info(`Revoked ${result.modifiedCount} tokens for user ${userId}`, {
        reason,
      });
      return result.modifiedCount;
    } catch (error) {
      logger.error("Error revoking all user tokens:", error);
      throw error;
    }
  }

  static async reassignUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await TokenSessionModel.updateMany(
      { userId: previousUserId },
      { $set: { userId: newUserId } },
      options,
    );
  }
}

module.exports = TokenSessionService;
