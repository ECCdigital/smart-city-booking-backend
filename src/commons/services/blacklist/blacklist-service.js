const { v4: uuidv4 } = require("uuid");
const BlacklistManager = require("../../data-managers/blacklist-manager");
const UserManager = require("../../data-managers/user-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const { CHECKOUT_REASONS } = require("../checkout/checkout-reasons");
const { DOMAIN: DOMAIN_REACH } = require("../authorization/reach");
const SuspensionService = require("../user/suspension-service");
// Required on use: settling reports by an entry asks `hits` back here.
const ReportService = () => require("../report/report-service");
const {
  BlacklistEntryKind,
  BLACKLIST_ENTRY_ORIGINS,
} = require("../../schemas/blacklistEntrySchema");
const { normalizeUserId } = require("../../utilities/user-id-utils");
const { parseEmails } = require("../../utilities/mail-utils");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

const ADDRESS = /^[^@\s]+@[^@\s]+$/;
const DOMAIN = /^@[^@\s]+$/;

/** A reason as stored: trimmed, required. */
function requiredReason(reason) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) {
    throw new BadRequestError("blacklist_reason_required");
  }
  return trimmed;
}

/**
 * The values an entry hitting this address would have, in order: the
 * exact address, then its domain. None for anything but an address.
 */
function candidatesOf(address) {
  const normalized = normalizeUserId(address);
  if (!ADDRESS.test(normalized)) return [];
  return [normalized, normalized.slice(normalized.indexOf("@"))];
}

/** An entry as a user answer names it, or `null`. */
const matchOf = (entry) =>
  entry ? { id: entry.id, value: entry.value, kind: entry.kind } : null;

/**
 * What the preview names of an account: who it is and the tenants it is an
 * active member of, by name.
 */
const accountOf = (user, tenantNames) => ({
  id: user.id,
  firstName: user.firstName ?? "",
  lastName: user.lastName ?? "",
  tenants: user.tenantIds.map((id) => ({
    id,
    name: tenantNames.get(id) ?? id,
  })),
});

/**
 * The blacklist of the instance (glossary „Blacklist“, „Blacklist-Eintrag“):
 * exact addresses and whole domains the instance
 * owner keeps for every tenant. Its one question for everyone else is
 * `match`: does an entry hit this address, and which one? A new entry
 * suspends the matching accounts at once with the origin `blacklist`;
 * removing it may lift exactly those suspensions.
 */
class BlacklistService {
  /**
   * An address or a domain as an entry stores it: trimmed and in lower
   * case as the user ids are, a domain with its leading `@`. Plus
   * addresses are addresses of their own.
   *
   * @param {*} value
   * @returns {{value: string, kind: string}}
   * @throws {BadRequestError} `blacklist_value_invalid` for anything else
   */
  static parse(value) {
    const normalized = normalizeUserId(value);
    if (DOMAIN.test(normalized)) {
      return { value: normalized, kind: BlacklistEntryKind.DOMAIN };
    }
    if (ADDRESS.test(normalized)) {
      return { value: normalized, kind: BlacklistEntryKind.ADDRESS };
    }
    throw new BadRequestError("blacklist_value_invalid", { value });
  }

  /**
   * Does an entry hit this address, and which one? The exact address
   * first, then its domain; a domain hits only itself, no subdomain.
   *
   * @param {*} address
   * @returns {Promise<Object|null>} The entry, or `null`
   */
  static async match(address) {
    for (const value of candidatesOf(address)) {
      const entry = await BlacklistManager.getEntryByValue(value);
      if (entry) return entry;
    }
    return null;
  }

  /**
   * The domain of an address as an entry stores it, with its leading `@`.
   *
   * @param {*} address
   * @returns {string|null} `null` for anything but an address
   */
  static domainOf(address) {
    return candidatesOf(address)[1] ?? null;
  }

  /**
   * Whether the entry hits the address: the exact address, or its domain.
   * The same rule as `match`, for one entry.
   *
   * @param {{value: string}} entry
   * @param {*} address
   * @returns {boolean}
   */
  static hits(entry, address) {
    return candidatesOf(address).includes(entry.value);
  }

  /**
   * Whether an entry hits any address of `mail`, each asked for itself:
   * the warning of the administration's ways,
   * which tells no more than that - never the entry or its reason.
   *
   * @param {*} mail One address or a list, as `mail` of a booking
   * @returns {Promise<boolean>}
   */
  static async isBlacklisted(mail) {
    for (const address of parseEmails(mail)) {
      if (await BlacklistService.match(address)) return true;
    }
    return false;
  }

  /**
   * Refuses the registration of an address on the blacklist,
   * before any account is created: with the
   * checkout's reason and, as there, only the instance's `mailAddress` to
   * write to with questions (empty where the instance has none) - never the
   * entry or its reason.
   *
   * @param {*} address
   * @returns {Promise<void>}
   * @throws {ConflictError} `checkout.address_blacklisted`
   */
  static async assertMayRegister(address) {
    if (!(await BlacklistService.match(address))) return;
    const instance = await InstanceManager.getInstance();
    throw new ConflictError(CHECKOUT_REASONS.ADDRESS_BLACKLISTED, {
      mailAddress: instance?.mailAddress || "",
    });
  }

  /**
   * The users with `blacklistMatch`, the entry that hits their address
   * now (`{ id, value, kind }`) or `null`. Reads
   * the blacklist once for all of them. For the answers of the instance
   * owner's user routes only.
   *
   * @param {Object[]} users
   * @returns {Promise<Object[]>}
   */
  static async withMatches(users) {
    const byValue = new Map(
      (await BlacklistManager.getEntries()).map((entry) => [
        entry.value,
        entry,
      ]),
    );
    return users.map((user) => {
      const value = candidatesOf(user.id).find((candidate) =>
        byValue.has(candidate),
      );
      return { ...user, blacklistMatch: matchOf(byValue.get(value)) };
    });
  }

  /** @returns {Promise<Object[]>} Every entry, newest first */
  static async list() {
    return BlacklistManager.getEntries();
  }

  /**
   * The accounts an entry of this value would hit, matched by the user
   * id: those it would suspend, the instance owners it leaves out and the
   * accounts already suspended, apart. `exists` tells an entry of this
   * value is already stored.
   *
   * @param {*} value An address or a domain
   * @returns {Promise<Object>}
   */
  static async preview(value) {
    const parsed = BlacklistService.parse(value);
    const groups = await BlacklistService._matchingAccounts(parsed);
    const tenantIds = [
      ...new Set(
        Object.values(groups).flatMap((users) =>
          users.flatMap((user) => user.tenantIds),
        ),
      ),
    ];
    const tenantNames = new Map(
      (await TenantManager.getTenantsByIds(tenantIds, DOMAIN_REACH)).map(
        (tenant) => [tenant.id, tenant.name],
      ),
    );
    const accountsOf = (users) =>
      users.map((user) => accountOf(user, tenantNames));
    return {
      ...parsed,
      exists: !!(await BlacklistManager.getEntryByValue(parsed.value)),
      accounts: {
        suspend: accountsOf(groups.suspend),
        instanceOwners: accountsOf(groups.instanceOwners),
        alreadySuspended: accountsOf(groups.alreadySuspended),
      },
    };
  }

  /**
   * Adds an entry and suspends the matching accounts at once, except
   * instance owners and accounts already suspended. Each suspension
   * carries the entry's reason, time and person and points to the entry,
   * and settles the open reports about its user as `suspended`. The entry
   * settles the open reports about every address it hits as `blacklisted`
   * and points to them (`reportIds`).
   *
   * @param {Object} params
   * @param {*} params.value An address or a domain
   * @param {*} params.reason Required
   * @param {string} params.by The instance owner who adds it
   * @param {string} [params.suspensionUserId] The user whose suspension
   *   adds the entry; gives it the origin `suspension`
   * @param {boolean} [params.fromReports] Whether the instance owner
   *   settles reports with it; gives it the origin `reports`
   * @returns {Promise<Object>} The stored entry
   */
  static async create({
    value,
    reason,
    by,
    suspensionUserId = null,
    fromReports = false,
  }) {
    const trimmedReason = requiredReason(reason);
    const parsed = BlacklistService.parse(value);
    if (await BlacklistManager.getEntryByValue(parsed.value)) {
      throw new ConflictError("blacklist_entry_exists", {
        value: parsed.value,
      });
    }

    const { suspend } = await BlacklistService._matchingAccounts(parsed);
    const entry = {
      id: uuidv4(),
      ...parsed,
      reason: trimmedReason,
      createdAt: Date.now(),
      createdBy: by,
      origin: suspensionUserId
        ? BLACKLIST_ENTRY_ORIGINS.SUSPENSION
        : fromReports
          ? BLACKLIST_ENTRY_ORIGINS.REPORTS
          : BLACKLIST_ENTRY_ORIGINS.MANUAL,
      suspendedUserIds: suspend.map((user) => user.id),
      suspensionUserId,
      reportIds: [],
    };
    let stored;
    try {
      stored = await BlacklistManager.insertEntry(entry);
    } catch (error) {
      // Added meanwhile by someone else: the unique index refuses it.
      if (error.code !== 11000) throw error;
      throw new ConflictError("blacklist_entry_exists", {
        value: parsed.value,
      });
    }

    for (const user of suspend) {
      await SuspensionService.suspendByBlacklistEntry(user.id, entry);
    }
    const reportIds = await ReportService().settleByBlacklistEntry(entry);
    if (reportIds.length === 0) return stored;
    return BlacklistManager.updateEntry(entry.id, { reportIds });
  }

  /**
   * Changes the reason of an entry; value and kind stay as they are.
   *
   * @param {string} id
   * @param {*} reason Required
   * @returns {Promise<Object>} The entry after the change
   */
  static async updateReason(id, reason) {
    const trimmedReason = requiredReason(reason);
    await BlacklistService._existingEntry(id);
    return BlacklistManager.updateEntry(id, { reason: trimmedReason });
  }

  /**
   * Removes an entry. With `unsuspend` it lifts the suspensions this entry
   * made and still holds; a suspension by hand or by another entry, made
   * since, stays.
   *
   * @param {string} id
   * @param {Object} [options]
   * @param {boolean} [options.unsuspend=false]
   * @returns {Promise<{unsuspendedUserIds: string[]}>}
   */
  static async remove(id, { unsuspend = false } = {}) {
    const entry = await BlacklistService._existingEntry(id);
    const unsuspendedUserIds = [];
    if (unsuspend) {
      for (const userId of entry.suspendedUserIds ?? []) {
        if (
          await SuspensionService.unsuspendIfByBlacklistEntry(userId, entry.id)
        ) {
          unsuspendedUserIds.push(userId);
        }
      }
    }
    await BlacklistManager.removeEntry(entry.id);
    return { unsuspendedUserIds };
  }

  /**
   * Removes the exact entry of an address, if there is one; an entry of
   * its domain stays. Lifts no suspension.
   *
   * @param {*} address
   * @returns {Promise<boolean>} Whether an entry was removed
   */
  static async removeAddressEntry(address) {
    const entry = await BlacklistManager.getEntryByValue(
      normalizeUserId(address),
    );
    if (entry?.kind !== BlacklistEntryKind.ADDRESS) return false;
    await BlacklistManager.removeEntry(entry.id);
    return true;
  }

  /**
   * The accounts an entry hits, sorted into the three groups, each with
   * the ids of the tenants it is an active member of.
   */
  static async _matchingAccounts({ value, kind }) {
    let users;
    if (kind === BlacklistEntryKind.DOMAIN) {
      users = await UserManager.getUsersOfDomain(value.slice(1));
    } else {
      const user = await UserManager.getUser(value);
      users = user ? [user] : [];
    }

    const groups = { suspend: [], instanceOwners: [], alreadySuspended: [] };
    for (const found of users) {
      const picture = await UserManager.getMembershipPicture(found.id);
      const user = {
        ...found,
        tenantIds: picture.memberships.map((entry) => entry.tenantId),
      };
      if (picture.instanceOwner) groups.instanceOwners.push(user);
      else if (user.isSuspended) groups.alreadySuspended.push(user);
      else groups.suspend.push(user);
    }
    return groups;
  }

  static async _existingEntry(id) {
    const entry = await BlacklistManager.getEntry(id);
    if (!entry) {
      throw new NotFoundError("blacklist_entry_not_found", { id });
    }
    return entry;
  }
}

module.exports = BlacklistService;
