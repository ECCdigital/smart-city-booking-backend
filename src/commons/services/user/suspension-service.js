const UserManager = require("../../data-managers/user-manager");
const BookingManager = require("../../data-managers/booking-manager");
const { SUSPENSION_ORIGINS } = require("../../entities/user/user");
const { DOMAIN } = require("../authorization/reach");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

// Required on use: the blacklist suspends through this service in turn.
const BlacklistService = () => require("../blacklist/blacklist-service");
// Required on use: settling reports by a suspension calls back here.
const ReportService = () => require("../report/report-service");

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
   * reasons do not pile up. With `blacklist` the user's address goes on the
   * blacklist too (ECCdigital/tickets#626): an entry of origin `suspension`
   * with the reason of the suspension, unless an entry already hits the
   * address. The suspension itself stays `manual`. It settles every open
   * report about the user as `suspended` and points to them
   * (`reportIds`, ECCdigital/tickets#630).
   *
   * @param {string} userId The user to suspend
   * @param {Object} params
   * @param {string} params.reason Why; required, stored trimmed
   * @param {string} params.by The instance owner who suspends
   * @param {boolean} [params.blacklist=false] Put the address on the blacklist
   * @returns {Promise<Object>} The user as `GET /users/:id` shows them
   */
  static async suspend(userId, { reason, by, blacklist = false }) {
    const trimmedReason = typeof reason === "string" ? reason.trim() : "";
    if (!trimmedReason) {
      throw new BadRequestError("suspension_reason_required");
    }
    const user = await SuspensionService._existingUser(userId);
    const picture = await UserManager.getMembershipPicture(user.id);
    if (picture.instanceOwner) {
      throw new ConflictError("instance_owner_not_suspendable");
    }
    // An id that is no address fails here, before anything is suspended.
    if (blacklist) BlacklistService().parse(user.id);

    const suspension = {
      reason: trimmedReason,
      suspendedAt: Date.now(),
      suspendedBy: by,
      origin: SUSPENSION_ORIGINS.MANUAL,
      reportIds: [],
    };
    await UserManager.updateUser({
      id: user.id,
      isSuspended: true,
      suspension,
    });
    // Settled once the suspension holds, so no tenant owner hears of one
    // that failed; the record then points to the reports.
    const reportIds = await ReportService().settleBySuspension(user.id, by);
    if (reportIds.length > 0) {
      await UserManager.updateUser({
        id: user.id,
        suspension: { ...suspension, reportIds },
      });
    }
    if (blacklist && !(await BlacklistService().match(user.id))) {
      try {
        await BlacklistService().create({
          value: user.id,
          reason: trimmedReason,
          by,
          suspensionUserId: user.id,
        });
      } catch (error) {
        // Added meanwhile by someone else: the address is on the blacklist.
        if (error.code !== "blacklist_entry_exists") throw error;
      }
    }
    return await UserManager.getUser(user.id);
  }

  /**
   * Lifts the suspension of a user, with or without a record. With
   * `removeBlacklistEntry` an exact entry of their address goes too
   * (ECCdigital/tickets#626); a domain entry stays and does not suspend
   * the account anew.
   *
   * @param {string} userId The user
   * @param {Object} [options]
   * @param {boolean} [options.removeBlacklistEntry=false]
   * @returns {Promise<Object>} The user as `GET /users/:id` shows them
   */
  static async unsuspend(userId, { removeBlacklistEntry = false } = {}) {
    const user = await SuspensionService._existingUser(userId);
    await SuspensionService._lift(user.id);
    if (removeBlacklistEntry) {
      await BlacklistService().removeAddressEntry(user.id);
    }
    return await UserManager.getUser(user.id);
  }

  /**
   * Suspends a user by a blacklist entry that matched their address when
   * it was added (ECCdigital/tickets#625): the entry's reason, time and
   * person, the origin `blacklist` and the entry as it is now. The caller
   * leaves out instance owners and users already suspended. As every
   * suspension it settles the open reports about the user and points to
   * them (ECCdigital/tickets#632).
   *
   * @param {string} userId The user to suspend
   * @param {Object} entry The blacklist entry
   */
  static async suspendByBlacklistEntry(userId, entry) {
    const suspension = {
      reason: entry.reason,
      suspendedAt: entry.createdAt,
      suspendedBy: entry.createdBy,
      origin: SUSPENSION_ORIGINS.BLACKLIST,
      blacklistEntry: { id: entry.id, value: entry.value },
      reportIds: [],
    };
    await UserManager.updateUser({
      id: userId,
      isSuspended: true,
      suspension,
    });
    const reportIds = await ReportService().settleBySuspension(
      userId,
      entry.createdBy,
    );
    if (reportIds.length > 0) {
      await UserManager.updateUser({
        id: userId,
        suspension: { ...suspension, reportIds },
      });
    }
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
   * to the user across every tenant, the tenants they are an active member
   * of and the blacklist entry that hits their address, if any
   * (ECCdigital/tickets#626) - for the checkboxes of both dialogs - and
   * per tenant the open reports a suspension settles with the tenant
   * owners it mails (ECCdigital/tickets#630).
   *
   * @param {string} userId The user
   * @returns {Promise<{bookings: number, memberships: number, blacklistEntry: Object|null, openReports: Object[]}>}
   */
  static async preview(userId) {
    const user = await SuspensionService._existingUser(userId);
    const picture = await UserManager.getMembershipPicture(user.id);
    const entry = await BlacklistService().match(user.id);
    return {
      bookings: await BookingManager.countAssignedBookings(user.id, DOMAIN),
      memberships: picture.memberships.length,
      blacklistEntry: entry
        ? { id: entry.id, value: entry.value, kind: entry.kind }
        : null,
      openReports: await ReportService().suspensionPreview(user.id),
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
