const { User, USER_HOOK_TYPES } = require("../entities/user/user");
const UserManager = require("../data-managers/user-manager");
const bunyan = require("bunyan");
const logger = bunyan.createLogger({
  name: "user-service.js",
  level: process.env.LOG_LEVEL,
});

class UserService {
  static async singUpUser(user, nextUrl, verifyUrl, invitation = null) {
    const MailController = require("../mail-service/mail-controller");
    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl, verifyUrl });
    const createdUser = await UserManager.createUser(user);

    if (invitation && invitation.token && invitation.tenantId) {
      await UserService._claimInvitationOnSignup(
        invitation.tenantId,
        invitation.token,
        createdUser.id,
      );
    }

    await MailController.sendVerificationRequest(
      createdUser.id,
      hook.id,
      verifyUrl,
    );
    await MailController.sendUserCreated(createdUser.id);
  }

  /**
   * Persist the invitation context on a pending membership during signup so it
   * can be recovered after email verification / login, independent of any
   * redirect. Best-effort: a failure here must never block account creation.
   */
  static async _claimInvitationOnSignup(tenantId, token, userId) {
    const InvitationService = require("./invitation-service");
    try {
      await InvitationService.claimInvitationForUser(tenantId, token, userId);
      logger.info(
        `Invitation ${token} claimed for newly registered user ${userId}`,
      );
    } catch (error) {
      logger.warn(
        `Could not claim invitation ${token} for user ${userId}: ${error.message || error}`,
      );
    }
  }

  static async releaseHook(hookId) {
    const user = await UserManager.getUserByHookID(hookId);

    const hook = user.hooks.find((hook) => hook.id === hookId);

    if (!hook) {
      throw { message: "Hook not found", status: 404 };
    }

    user.releaseHook(hookId);

    await UserManager.updateUser(user);

    let additionalUrl = "";

    if (hook.type === USER_HOOK_TYPES.VERIFY) {
      additionalUrl = "/email/verify";
    } else if (hook.type === USER_HOOK_TYPES.RESET_PASSWORD) {
      additionalUrl = "/password/confirmed";
    }

    if (hook.payload && hook.payload.nextUrl) {
      additionalUrl += `?next=${encodeURIComponent(hook.payload.nextUrl)}`;
    }

    return additionalUrl;
  }

  static async verifyEmail(token, id) {
    const user = await UserManager.getUserByHookID(token);

    if (!user) {
      const secondaryUser = await UserManager.getUser(id);
      if (secondaryUser.isVerified) {
        throw { message: "User already verified", status: 410 };
      } else {
        throw { message: "User not found", status: 404 };
      }
    }

    if (user.id !== id) {
      throw { message: "User ID does not match token", status: 400 };
    }

    const hook = user.hooks.find((hook) => hook.id === token);

    if (!hook || hook.type !== USER_HOOK_TYPES.VERIFY) {
      throw { message: "Invalid verification token", status: 400 };
    }

    user.releaseHook(token);

    await UserManager.updateUser(user);

    return { success: true };
  }

  static async requestForgotPassword(email, resetUrl) {
    const MailController = require("../mail-service/mail-controller");
    const user = await UserManager.getUser(email, true);

    if (!user || user.authType !== "local" || user.isSuspended) {
      return { success: true };
    }

    const userEntity = user instanceof User ? user : new User(user);

    userEntity.hooks.forEach((hook) => {
      if (
        hook.type === USER_HOOK_TYPES.FORGOT_PASSWORD &&
        hook.status === "active"
      ) {
        hook.status = "revoked";
      }
    });
    
    const hook = userEntity.addForgotPasswordHook(resetUrl);
    await UserManager.updateUser(userEntity);
    await MailController.sendForgotPasswordRequest(
      userEntity.id,
      hook.id,
      resetUrl,
    );

    logger.info(`Forgot password request sent to user ${userEntity.id}`);

    return { success: true };
  }

  static async resetPasswordWithToken(token, password, id) {
    const user = await UserManager.getUserByHookID(token);

    if (!user) {
      throw { message: "Invalid or expired token", status: 400 };
    }

    if (user.id.toLowerCase() !== id.toLowerCase()) {
      throw { message: "User ID does not match token", status: 400 };
    }

    const hook = user.hooks.find((hook) => hook.id === token);

    if (!hook || hook.type !== USER_HOOK_TYPES.FORGOT_PASSWORD) {
      throw { message: "Invalid or expired token", status: 400 };
    }

    if (hook.status !== "active") {
      throw { message: "Token already used or expired", status: 410 };
    }

    user.setPassword(password);
    user.releaseHook(token);

    await UserManager.updateUser(user);

    logger.info(`Password reset for user ${user.id}`);

    return { success: true };
  }
}

module.exports = UserService;
