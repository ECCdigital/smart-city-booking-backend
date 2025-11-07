const { USER_HOOK_TYPES } = require("../entities/user/user");
const UserManager = require("../data-managers/user-manager");

class UserService {
  static async singUpUser(user, nextUrl) {
    const MailController = require("../mail-service/mail-controller");
    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl });
    const createdUser = await UserManager.storeUser(user);
    await MailController.sendVerificationRequest(createdUser.id, hook.id);
    await MailController.sendUserCreated(createdUser.id);
  }

  static async releaseHook(hookId) {
    const user = await UserManager.getUserByHookID(hookId);

    const hook = user.hooks.find((hook) => hook.id === hookId);

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
}

module.exports = UserService;
