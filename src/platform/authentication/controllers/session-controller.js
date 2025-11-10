const bunyan = require('bunyan');
const tokenSessionService = require('../../../commons/services/token-session-service');
const JwtHelper = require('../../../commons/utilities/jwt-helper');

const logger = bunyan.createLogger({
  name: 'session-controller',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Controller für Session-Management
 * Ermöglicht Benutzern ihre aktiven Sessions zu verwalten
 */
class SessionController {
  /**
   * Gibt alle aktiven Sessions eines Users zurück
   */
  static async getUserSessions(request, response) {
    try {
      if (!request.user) {
        return response.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const sessions = await tokenSessionService.getUserActiveSessions(request.user.id);

      // Markiere aktuelle Session
      const currentJti = request.user.jti;
      const enrichedSessions = sessions.map(session => ({
        id: session._id,
        jti: session.jti,
        tokenType: session.tokenType,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        isCurrent: session.jti === currentJti,
      }));

      response.status(200).json({
        success: true,
        sessions: enrichedSessions,
        total: enrichedSessions.length,
      });
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      response.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Invalidiert eine spezifische Session
   */
  static async revokeSession(request, response) {
    try {
      if (!request.user) {
        return response.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { sessionId } = request.params;

      const success = await tokenSessionService.revokeSession(
        sessionId,
        request.user.id
      );

      if (success) {
        logger.info(`Session ${sessionId} revoked by user ${request.user.id}`);
        response.status(200).json({
          success: true,
          message: 'Session revoked successfully',
        });
      } else {
        response.status(404).json({
          success: false,
          message: 'Session not found',
        });
      }
    } catch (error) {
      logger.error('Error revoking session:', error);
      response.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Invalidiert alle Sessions außer der aktuellen
   */
  static async revokeOtherSessions(request, response) {
    try {
      if (!request.user) {
        return response.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      // Hole alle aktiven Sessions
      const sessions = await tokenSessionService.getUserActiveSessions(request.user.id);

      // Revoke alle außer der aktuellen
      const currentJti = request.user.jti;
      let revokedCount = 0;

      for (const session of sessions) {
        if (session.jti !== currentJti) {
          const authHeader = `Bearer ${session.jti}`; // Dummy, wir nutzen JTI direkt
          await tokenSessionService.addToBlacklist(session.jti, 'user_revoke_other_sessions');
          revokedCount++;
        }
      }

      logger.info(`User ${request.user.id} revoked ${revokedCount} other sessions`);

      response.status(200).json({
        success: true,
        message: `${revokedCount} session(s) revoked`,
        revokedCount,
      });
    } catch (error) {
      logger.error('Error revoking other sessions:', error);
      response.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Invalidiert ALLE Sessions eines Users (inkl. der aktuellen)
   */
  static async revokeAllSessions(request, response) {
    try {
      if (!request.user) {
        return response.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const count = await JwtHelper.revokeAllUserTokens(
        request.user.id,
        'user_revoke_all_sessions'
      );

      logger.info(`User ${request.user.id} revoked all ${count} sessions`);

      response.status(200).json({
        success: true,
        message: `All ${count} session(s) revoked. Please login again.`,
        revokedCount: count,
      });
    } catch (error) {
      logger.error('Error revoking all sessions:', error);
      response.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Gibt Session-Statistiken zurück
   */
  static async getSessionStats(request, response) {
    try {
      if (!request.user) {
        return response.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const stats = await tokenSessionService.getStats();

      response.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error('Error getting session stats:', error);
      response.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

module.exports = SessionController;

