const { USER_HOOK_TYPES } = require("../entities/user/user");
const UserManager = require("../data-managers/user-manager");

class UserService {
  static async singUpUser(user, nextUrl, verifyUrl) {
    const MailController = require("../mail-service/mail-controller");
    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl, verifyUrl });
    const createdUser = await UserManager.storeUser(user);
    await MailController.sendVerificationRequest(
      createdUser.id,
      hook.id,
      verifyUrl,
    );
    await MailController.sendUserCreated(createdUser.id);
  }

  static async releaseHook(hookId) {
    const user = await UserManager.getUserByHookID(hookId);

    const hook = user.hooks.find((hook) => hook.id === hookId);

    if (!hook) {
      throw { message: "Hook not found", status: 404 };
    }

    user.releaseHook(hookId);

    await UserManager.storeUser(user);

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

    await UserManager.storeUser(user);

    return { success: true };
  }
}

module.exports = UserService;
