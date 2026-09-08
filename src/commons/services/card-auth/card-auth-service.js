const axios = require("axios");
const bunyan = require("bunyan");
const InstanceManager = require("../../data-managers/instance-manager");
const UserManager = require("../../data-managers/user-manager");
const mailService = require("../../mail-service");

const logger = bunyan.createLogger({
  name: "card-auth-service",
  level: process.env.LOG_LEVEL,
});

class CardAuthService {
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

  static async getAvailableCardAuthMethods() {
    const instance = await InstanceManager.getInstance();
    return instance.applications
      .filter((a) => a.type === "card-auth" && a.enabled)
      .map((a) => a.toPublicConfig());
  }

  /**
   * Step 1 of login: verify card + look up local user by publicId.
   * Returns either { status: "authenticated", user, permissions }
   * or     { status: "registration_required", prefill, verification }.
   */
  static async verifyCardAndResolveUser(appId, publicId, secret) {
    const app = await CardAuthService.getCardApp(appId);

    const verification = await CardAuthService.callVerifyEndpoint(
      app,
      publicId,
      secret,
    );

    if (!verification.valid) {
      const reasonMessages = {
        not_found: "Card not found",
        secret_mismatch: "Invalid card credentials",
        expired: `Card expired on ${verification.expiredAt}`,
      };
      throw {
        message:
          reasonMessages[verification.reason] || "Card verification failed",
        status: 401,
        reason: verification.reason,
      };
    }

    // Look up local user by card publicId + appId
    const user = await UserManager.getUserByCard(appId, publicId);

    if (user) {
      if (user.isSuspended) {
        throw { message: "User account is suspended", status: 403 };
      }
      if (!user.isVerified) {
        throw {
          message: "Please verify your email before logging in",
          status: 403,
          reason: "email_not_verified",
        };
      }

      const permissions = await UserManager.getUserPermissions(user.id);
      logger.info(`Card auth login: user=${user.id}, app=${appId}`);

      return { status: "authenticated", user, permissions };
    }

    // No user linked → frontend should show registration form
    return {
      status: "registration_required",
      prefill: {
        email: verification.owner?.email || "",
        firstName: verification.owner?.firstName || "",
        lastName: verification.owner?.lastName || "",
        company: verification.owner?.company || "",
      },
      cardInfo: {
        appId,
        publicId,
        cardType: verification.cardType,
      },
    };
  }

  static async registerWithCard({
    appId,
    publicId,
    secret,
    email,
    firstName,
    lastName,
    company,
    nextUrl,
    verifyUrl,
    linkUrl,
    legalAcceptance,
  }) {
    const app = await CardAuthService.getCardApp(appId);

    const verification = await CardAuthService.callVerifyEndpoint(
      app,
      publicId,
      secret,
    );
    if (!verification.valid) {
      throw {
        message: "Card verification failed",
        status: 401,
        reason: verification.reason,
      };
    }

    const existingCardUser = await UserManager.getUserByCard(appId, publicId);
    if (existingCardUser) {
      throw {
        message: "This card is already linked to another account",
        status: 409,
        reason: "card_already_linked",
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingEmailUser = await UserManager.getUser(normalizedEmail, true);

    if (existingEmailUser) {
      if (existingEmailUser.isSuspended) {
        throw {
          message: "User account is suspended",
          status: 403,
        };
      }

      if (existingEmailUser.cardAuth) {
        throw {
          message:
            "This account already has a card linked. Please contact support to change it.",
          status: 409,
          reason: "account_already_has_card",
        };
      }

      const { USER_HOOK_TYPES } = require("../../entities/user/user");

      const hook = existingEmailUser.addHook(USER_HOOK_TYPES.LINK_CARD, {
        appId,
        publicId,
        cardType: verification.cardType || app.cardType || "",
      });

      await UserManager.updateUser(existingEmailUser);

      await mailService.notify("CARD_LINK_REQUEST", {
        to: existingEmailUser.id,
        firstName: existingEmailUser.firstName,
        hookId: hook.id,
        cardLabel: app.label,
        linkUrlBase: linkUrl,
      });

      logger.info(
        `Card link request sent: user=${existingEmailUser.id}, app=${appId}`,
      );

      return {
        status: "link_requested",
        message:
          "A confirmation email has been sent to link the card with your existing account.",
      };
    }

    const { User } = require("../../entities/user/user");
    const UserService = require("../user-service");

    const user = new User({
      id: normalizedEmail,
      firstName,
      lastName,
      company,
      authType: "card",
      cardAuth: {
        appId,
        publicId,
        cardType: verification.cardType || app.cardType || "",
        linkedAt: Date.now(),
      },
      legalAcceptance,
    });
    user.secret = undefined;

    await UserService.singUpUser(user, nextUrl, verifyUrl);

    logger.info(`Card registration (new user): user=${user.id}, app=${appId}`);

    return { status: "registered", userId: user.id };
  }

  static async callVerifyEndpoint(app, publicId, secret) {
    try {
      const payload = { publicId, secret };
      if (app.cardType) payload.cardType = app.cardType;

      const response = await axios.post(`${app.serviceUrl}/verify`, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${app.apiToken}`,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(
          `Card service responded with ${error.response.status}`,
          error.response.data,
        );
        throw { message: "Card verification service error", status: 502 };
      }
      logger.error("Card service unreachable", error.message);
      throw { message: "Card verification service unavailable", status: 503 };
    }
  }
  /**
   * Confirms a pending card-link request via hookId.
   * Called when user clicks the confirmation link in their email.
   */
  static async confirmCardLink(hookId, email) {
    const { USER_HOOK_TYPES } = require("../../entities/user/user");

    const user = await UserManager.getUserByHookID(hookId);
    if (!user) {
      throw { message: "Invalid or expired link", status: 404 };
    }

    if (email && user.id !== email.toLowerCase().trim()) {
      throw { message: "Link does not match user", status: 400 };
    }

    const hook = user.hooks.find((h) => h.id === hookId);
    if (!hook || hook.type !== USER_HOOK_TYPES.LINK_CARD) {
      throw { message: "Invalid link type", status: 400 };
    }

    if (hook.status !== "active") {
      throw { message: "This link has already been used", status: 410 };
    }

    const otherUser = await UserManager.getUserByCard(
      hook.payload.appId,
      hook.payload.publicId,
    );
    if (otherUser && otherUser.id !== user.id) {
      throw {
        message: "This card is already linked to another account",
        status: 409,
      };
    }

    user.cardAuth = {
      appId: hook.payload.appId,
      publicId: hook.payload.publicId,
      cardType: hook.payload.cardType || "",
      linkedAt: Date.now(),
    };

    user.releaseHook(hookId);
    await UserManager.updateUser(user);

    logger.info(`Card linked to existing user: ${user.id}`);

    return { user };
  }
}

module.exports = CardAuthService;
