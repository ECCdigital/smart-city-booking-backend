const { USER_HOOK_TYPES } = require("../entities/user/user");
const UserManager = require("../data-managers/user-manager");
const BookingManager = require("../data-managers/booking-manager");
const GroupBookingManager = require("../data-managers/group-booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const CouponManager = require("../data-managers/coupon-manager");

class UserService {
  static async singUpUser(user, nextUrl) {
    const MailController = require("../mail-service/mail-controller");
    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl });
    const createdUser = await UserManager.createUser(user);
    await MailController.sendVerificationRequest(createdUser.id, hook.id);
    await MailController.sendUserCreated(createdUser.id);
  }

  static async releaseHook(hookId) {
    const user = await UserManager.getUserByHookID(hookId);

    const hook = user.hooks.find((hook) => hook.id === hookId);

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

  static async changeUserId({
    currentId,
    newId,
    keycloakId = null,
    anonymize = false,
  }) {
    const normalizedCurrentId = String(currentId || "").trim().toLowerCase();
    const normalizedNewId = String(newId || "").trim().toLowerCase();
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

    if (Object.keys(userSet).length > 0) {
      await UserManager.updateUserByMongoId(currentUser._id, userSet);
    }

    if (previousId !== normalizedNewId) {
      await BookingManager.reassignUserReferences(previousId, normalizedNewId);
      await GroupBookingManager.reassignUserReferences(
        previousId,
        normalizedNewId,
      );
      await BookableManager.reassignOwnerUserId(previousId, normalizedNewId);
      await EventManager.reassignOwnerUserId(previousId, normalizedNewId);
      await CouponManager.reassignOwnerUserId(previousId, normalizedNewId);
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
  }) {
    const normalizedUserId = String(userId || "").trim().toLowerCase();
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

    const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim();
    await BookingManager.updateAssignedSelfBookingNames(currentUser.id, fullName);

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
    };
  }
}

module.exports = UserService;
