const axios = require("axios");
const bunyan = require("bunyan");
const InstanceManager = require("../../data-managers/instance-manager");
const UserManager = require("../../data-managers/user-manager");

const logger = bunyan.createLogger({
  name: "card-auth-service",
  level: process.env.LOG_LEVEL,
});

class CardAuthService {
  /**
   * Finds a CardAuthApplication on the instance by its application ID.
   * Decrypts the API token for use.
   *
   * @param {string} appId - The application ID (e.g. "ehrenamtskarte")
   * @returns {CardAuthApplication}
   */
  static async getCardApp(appId) {
    const instance = await InstanceManager.getInstance();
    const app = instance.applications.find(
      (a) => a.id === appId && a.type === "card-auth",
    );

    if (!app) {
      throw { message: `Card auth app "${appId}" not found`, status: 404 };
    }

    if (!app.enabled) {
      throw {
        message: `Card auth app "${appId}" is not enabled`,
        status: 403,
      };
    }

    return app;
  }

  /**
   * Returns all enabled card-auth applications as public configs
   * (for the frontend to render login forms).
   */
  static async getAvailableCardAuthMethods() {
    const instance = await InstanceManager.getInstance();
    return instance.applications
      .filter((a) => a.type === "card-auth" && a.enabled)
      .map((a) => a.toPublicConfig());
  }

  /**
   * Verifies a card against the external microservice
   * and returns the local user.
   *
   * @param {string} appId - Application ID on the instance
   * @param {string} publicId - The card's public identifier
   * @param {string} secret - The card's secret
   * @param {string} userId - The local user ID (= owner)
   * @returns {{ user: User, permissions: string[] }}
   */
  static async verifyAndLogin(appId, publicId, secret, userId) {
    const app = await CardAuthService.getCardApp(appId);

    // 1. Verify card against microservice
    const verificationResult = await CardAuthService.callVerifyEndpoint(
      app,
      publicId,
      secret,
      userId,
    );

    if (!verificationResult.valid) {
      const reasonMessages = {
        not_found: "Card not found",
        secret_mismatch: "Invalid secret",
        owner_mismatch: "Card does not belong to this user",
        expired: `Card expired on ${verificationResult.expiredAt}`,
      };

      throw {
        message:
          reasonMessages[verificationResult.reason] ||
          "Card verification failed",
        status: 401,
        reason: verificationResult.reason,
      };
    }

    // 2. Load local user
    const user = await UserManager.getUser(userId, false);

    if (!user) {
      throw { message: "User not found", status: 404 };
    }

    if (user.isSuspended) {
      throw { message: "User account is suspended", status: 403 };
    }

    // 3. Get permissions
    const permissions = await UserManager.getUserPermissions(userId);

    logger.info(
      `Card auth login: user=${userId}, app=${appId}, ` +
        `cardType=${verificationResult.cardType}`,
    );

    return { user, permissions };
  }

  /**
   * Calls the external card microservice's /verify endpoint.
   */
  static async callVerifyEndpoint(app, publicId, secret, owner) {
    try {
      const payload = {
        publicId,
        secret,
        owner,
      };

      if (app.cardType) {
        payload.cardType = app.cardType;
      }

      const response = await axios.post(
        `${app.serviceUrl}/verify`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${app.apiToken}`,
          },
          timeout: 10000,
        },
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(
          `Card microservice responded with ${error.response.status}`,
          error.response.data,
        );
        throw {
          message: "Card verification service error",
          status: 502,
        };
      }

      logger.error("Card microservice unreachable", error.message);
      throw {
        message: "Card verification service unavailable",
        status: 503,
      };
    }
  }
}

module.exports = CardAuthService;
