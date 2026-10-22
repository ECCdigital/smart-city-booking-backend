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
    await SuspensionService._lift(user.id);
    return await UserManager.getUser(user.id);
  }

  /**
   * Suspends a user by a blacklist entry that matched their address when
   * it was added (ECCdigital/tickets#625): the entry's reason, time and
   * person, the origin `blacklist` and the entry as it is now. The caller
   * leaves out instance owners and users already suspended.
   *
   * @param {string} userId The user to suspend
   * @param {Object} entry The blacklist entry
   */
  static async suspendByBlacklistEntry(userId, entry) {
    await UserManager.updateUser({
      id: userId,
      isSuspended: true,
      suspension: {
        reason: entry.reason,
        suspendedAt: entry.createdAt,
        suspendedBy: entry.createdBy,
        origin: SUSPENSION_ORIGINS.BLACKLIST,
        blacklistEntry: { id: entry.id, value: entry.value },
      },
    });
  }

  /**
   * Lifts the suspension of a user only if it still comes from this
   * blacklist entry; a suspension by hand or by another entry stays.
   *
   * @param {string} userId The user
   * @param {string} entryId The blacklist entry
   * @returns {Promise<boolean>} Whether the suspension was lifted
   */
  static async unsuspendIfByBlacklistEntry(userId, entryId) {
    const user = await UserManager.getUser(userId);
    const { suspension } = user ?? {};
    if (
      !user?.isSuspended ||
      suspension?.origin !== SUSPENSION_ORIGINS.BLACKLIST ||
      suspension.blacklistEntry?.id !== entryId
    ) {
      return false;
    }
    await SuspensionService._lift(user.id);
    return true;
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

  static async _lift(userId) {
    await UserManager.updateUser({
      id: userId,
      isSuspended: false,
      suspension: null,
    });
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
