const { User, USER_HOOK_TYPES } = require("../entities/user/user");
const mongoose = require("mongoose");
const UserManager = require("../data-managers/user-manager");
const bunyan = require("bunyan");
const logger = bunyan.createLogger({
  name: "user-service.js",
  level: process.env.LOG_LEVEL,
});
const BookingManager = require("../data-managers/booking-manager");
const GroupBookingManager = require("../data-managers/group-booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const CouponManager = require("../data-managers/coupon-manager");
const MembershipManager = require("../data-managers/membership-manager");
const InstanceManager = require("../data-managers/instance-manager");
const TokenSessionService = require("./token-session-service");
const { notify } = require("../mail-service");

class UserService {
  static async singUpUser(user, nextUrl, verifyUrl, invitation = null) {
    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl, verifyUrl });
    const createdUser = await UserManager.createUser(user);

    if (invitation && invitation.token && invitation.tenantId) {
      await UserService._claimInvitationOnSignup(
        invitation.tenantId,
        invitation.token,
        createdUser.id,
      );
    }

    await notify("VERIFICATION_REQUEST", {
      to: createdUser.id,
      hookId: hook.id,
      verifyUrl,
    });
    await notify("USER_CREATED", { userId: createdUser.id });
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
    await notify("FORGOT_PASSWORD_REQUEST", {
      to: userEntity.id,
      hookId: hook.id,
      resetUrl,
    });

    logger.info(`Forgot password request sent to user ${userEntity.id}`);

    return { success: true };
  }

  /**
   * The password change of a signed-in user: the new password stands
   * behind a hook the user confirms from the password reset mail. Lived in
   * `UserManager` until the mail-stack chain.
   */
  static async resetPassword(user, password) {
    const userEntity = user instanceof User ? user : new User(user);

    const hook = userEntity.addPasswordResetHook(password);
    await UserManager.updateUser(userEntity);
    await notify("PASSWORD_RESET", { to: userEntity.id, hookId: hook.id });
    return hook;
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

  static async syncSelfBookingNames(userId, firstName, lastName) {
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim();

    if (!fullName) {
      return;
    }

    await BookingManager.updateAssignedSelfBookingNames(userId, fullName);
  }

  static _isTransactionUnsupportedError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("replica set") ||
      message.includes("mongos") ||
      (message.includes("transaction") && message.includes("not supported"))
    );
  }

  static async _runWithOptionalTransaction(callback) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => callback(session));
    } catch (error) {
      if (!UserService._isTransactionUnsupportedError(error)) {
        throw error;
      }
      await callback(null);
    } finally {
      await session.endSession();
    }
  }

  static async changeUserId({
    currentId,
    newId,
    keycloakId = null,
    anonymize = false,
  }) {
    const normalizedCurrentId = String(currentId || "")
      .trim()
      .toLowerCase();
    const normalizedNewId = String(newId || "")
      .trim()
      .toLowerCase();
    const normalizedKeycloakId = String(keycloakId || "").trim();

    if (!normalizedNewId) {
      throw { message: "Missing required parameters", status: 400 };
    }

    const currentUser = await UserManager.findRawUserByIdOrKeycloak(
      normalizedCurrentId,
      normalizedKeycloakId,
    );
    if (!currentUser) {
      throw { message: "User not found", status: 404 };
    }

    const previousId = currentUser.id;

    if (previousId !== normalizedNewId) {
      const existingTargetUser = await UserManager.getRawUserBy({
        id: normalizedNewId,
      });
      if (
        existingTargetUser &&
        String(existingTargetUser._id) !== String(currentUser._id)
      ) {
        throw { message: "Target user id already exists", status: 409 };
      }
    }

    const userSet = {};
    if (previousId !== normalizedNewId) {
      userSet.id = normalizedNewId;
    }
    if (normalizedKeycloakId) {
      userSet.keycloakId = normalizedKeycloakId;
    }
    if (anonymize === true) {
      userSet.firstName = "Gelöschtes Profil";
      userSet.lastName = "";
    }

    const applyChange = async (session) => {
      if (previousId !== normalizedNewId) {
        await BookingManager.reassignUserReferences(
          previousId,
          normalizedNewId,
          session,
        );
        await GroupBookingManager.reassignUserReferences(
          previousId,
          normalizedNewId,
          session,
        );
        await BookableManager.reassignOwnerUserId(
          previousId,
          normalizedNewId,
          session,
        );
        await EventManager.reassignOwnerUserId(
          previousId,
          normalizedNewId,
          session,
        );
        await CouponManager.reassignOwnerUserId(
          previousId,
          normalizedNewId,
          session,
        );
        await MembershipManager.reassignUserId(
          previousId,
          normalizedNewId,
          session,
        );
        await TokenSessionService.reassignUserId(
          previousId,
          normalizedNewId,
          session,
        );
        await InstanceManager.reassignOwnerUserId(
          previousId,
          normalizedNewId,
          session,
        );
      }

      if (Object.keys(userSet).length > 0) {
        await UserManager.updateUserByMongoId(
          currentUser._id,
          userSet,
          session,
        );
      }
    };

    await UserService._runWithOptionalTransaction(applyChange);

    if (anonymize === true) {
      const targetId =
        previousId !== normalizedNewId ? normalizedNewId : previousId;
      await UserService.syncSelfBookingNames(targetId, userSet.firstName, "");
    }

    return {
      previousId,
      id: normalizedNewId,
      changed: previousId !== normalizedNewId,
    };
  }

  static async updateUserNames({
    userId,
    firstName,
    lastName,
    keycloakId = null,
    syncSelfBookingNames = true,
  }) {
    const normalizedUserId = String(userId || "")
      .trim()
      .toLowerCase();
    const normalizedKeycloakId = String(keycloakId || "").trim();
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();

    if (!normalizedFirstName || !normalizedLastName) {
      throw { message: "Missing required parameters", status: 400 };
    }

    const currentUser = await UserManager.findRawUserByIdOrKeycloak(
      normalizedUserId,
      normalizedKeycloakId,
    );
    if (!currentUser) {
      throw { message: "User not found", status: 404 };
    }

    const updated = await UserManager.updateUserNamesByMongoId(
      currentUser._id,
      normalizedFirstName,
      normalizedLastName,
      normalizedKeycloakId || null,
    );
    if (!updated) {
      throw { message: "User not found", status: 404 };
    }

    if (syncSelfBookingNames !== false) {
      await UserService.syncSelfBookingNames(
        updated.id,
        normalizedFirstName,
        normalizedLastName,
      );
    }

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
    };
  }
}

module.exports = UserService;
