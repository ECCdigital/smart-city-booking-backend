const UserManager = require("../../data-managers/user-manager");
const BookingManager = require("../../data-managers/booking-manager");
const { SUSPENSION_ORIGINS } = require("../../entities/user/user");
const { DOMAIN } = require("../authorization/reach");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

/**
 * The suspension of a user (glossary „Sperre (eines Users)“,
 * ECCdigital/tickets#624): the instance owner suspends and lifts it as
 * actions of their own, never over the general update of the user. It
 * stays the check of `isSuspended` at the authentication and at every
 * sign-in, so it takes effect at once, running sessions included.
 */
class SuspensionService {
  /**
   * Suspends a user. A suspension already in place gets the new record:
   * reasons do not pile up.
   *
   * @param {string} userId The user to suspend
   * @param {Object} params
   * @param {string} params.reason Why; required, stored trimmed
   * @param {string} params.by The instance owner who suspends
   * @returns {Promise<Object>} The user as `GET /users/:id` shows them
   */
  static async suspend(userId, { reason, by }) {
    const trimmedReason = typeof reason === "string" ? reason.trim() : "";
    if (!trimmedReason) {
      throw new BadRequestError("suspension_reason_required");
    }
    const user = await SuspensionService._existingUser(userId);
    const picture = await UserManager.getMembershipPicture(user.id);
    if (picture.instanceOwner) {
      throw new ConflictError("instance_owner_not_suspendable");
    }

    await UserManager.updateUser({
      id: user.id,
      isSuspended: true,
      suspension: {
        reason: trimmedReason,
        suspendedAt: Date.now(),
        suspendedBy: by,
        origin: SUSPENSION_ORIGINS.MANUAL,
      },
    });
    return await UserManager.getUser(user.id);
  }

  /**
   * Lifts the suspension of a user, with or without a record.
   *
   * @param {string} userId The user
   * @returns {Promise<Object>} The user as `GET /users/:id` shows them
   */
  static async unsuspend(userId) {
    const user = await SuspensionService._existingUser(userId);
    await UserManager.updateUser({
      id: user.id,
      isSuspended: false,
      suspension: null,
    });
    return await UserManager.getUser(user.id);
  }

  /**
   * The consequences of a suspension for its dialog: the bookings assigned
   * to the user across every tenant and the tenants they are an active
   * member of.
   *
   * @param {string} userId The user
   * @returns {Promise<{bookings: number, memberships: number}>}
   */
  static async preview(userId) {
    const user = await SuspensionService._existingUser(userId);
    const picture = await UserManager.getMembershipPicture(user.id);
    return {
      bookings: await BookingManager.countAssignedBookings(user.id, DOMAIN),
      memberships: picture.memberships.length,
    };
  }

  static async _existingUser(userId) {
    const user = await UserManager.getUser(userId);
    if (!user) {
      throw new NotFoundError("user_not_found", { id: userId });
    }
    return user;
  }
}

module.exports = SuspensionService;
