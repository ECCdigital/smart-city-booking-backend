const { v4: uuidv4 } = require("uuid");
const ReportManager = require("../../data-managers/report-manager");
const UserManager = require("../../data-managers/user-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const MembershipService = require("../membership/membership-service");
const SupervisionNotificationService = require("../supervision/supervision-notification-service");
const { NOTIFICATION_TYPES } = require("../supervision/supervision-constants");
const { DOMAIN } = require("../authorization/reach");
const { REPORT_STATUS } = require("../../schemas/reportSchema");
const { BlacklistEntryKind } = require("../../schemas/blacklistEntrySchema");
const { normalizeUserId } = require("../../utilities/user-id-utils");
const { parseEmails } = require("../../utilities/mail-utils");
const Formatters = require("../../utilities/formatters");
const {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");

// Required on use: the suspension settles reports through this service.
const SuspensionService = () => require("../user/suspension-service");
// Required on use: a blacklist entry settles reports through this service.
const BlacklistService = () => require("../blacklist/blacklist-service");

/**
 * The outcomes the instance owner settles open reports with: a user with
 * a suspension, an address with a blacklist entry,
 * either with a rejection.
 */
const DECISIONS = Object.freeze({
  SUSPEND: "suspend",
  BLACKLIST: "blacklist",
  REJECT: "reject",
});

/** The target of a report as stored: a user or an address, never both. */
const targetKeyOf = ({ userId = null, address = null }) => ({
  targetUserId: userId,
  targetAddress: address,
});

/** A reason as stored: trimmed, required, with the error code to throw. */
function requiredText(value, code) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new BadRequestError(code);
  return trimmed;
}

const nameOf = (user) => Formatters.formatUserName(user) ?? "";

/** The names of the tenants, by id; an unknown tenant is named by its id. */
async function tenantNamesOf(tenantIds) {
  const ids = [...new Set(tenantIds)];
  const names = new Map(ids.map((id) => [id, id]));
  for (const tenant of await TenantManager.getTenantsByIds(ids, DOMAIN)) {
    names.set(tenant.id, tenant.name);
  }
  return names;
}

/**
 * The reports (glossary „Meldung (eines Users oder einer Adresse)“):
 * a tenant reports a member or the booker of one
 * of its bookings to the instance, or an address from `mail` of one of its
 * bookings; the instance owner settles every open
 * report about the user or the address at once, with a suspension or a
 * blacklist entry, or a rejection with a reason. The reported user or
 * guest learns nothing; the instance owners learn of a new report and the
 * tenant owners of each reporting tenant of the outcome, both over the
 * supervision outbox.
 */
class ReportService {
  /**
   * Reports a user to the instance. The target is a member of the tenant
   * or the booker of the booking named (`assignedUserId`, with an
   * account), seen or not; a tenant owner only by a tenant owner, an
   * instance owner by nobody. An open report of the tenant about the user
   * gets the reason added instead of a second report. With
   * `endMembership` the membership of a member ends with the report, its
   * open invitations included.
   *
   * @param {Object} params
   * @param {string} params.tenantId The reporting tenant
   * @param {string} [params.userId] The user reported
   * @param {string} [params.bookingId] The booking reported from: its
   *   booker is the target and it hangs at the report as evidence
   * @param {*} params.reason Required
   * @param {string} params.by Who reports
   * @param {boolean} params.mayReportOwner Whether who reports is a
   *   tenant owner (or the instance owner)
   * @param {boolean} [params.endMembership] Whether the membership of
   *   the target ends with the report
   * @returns {Promise<{report: Object, created: boolean}>}
   */
  static async report({
    tenantId,
    userId,
    bookingId,
    reason,
    by,
    mayReportOwner,
    endMembership = false,
  }) {
    const trimmedReason = requiredText(reason, "report_reason_required");
    const targetUserId = await ReportService._target(tenantId, {
      userId,
      bookingId,
    });

    const target = await UserManager.getUser(targetUserId);
    if (!target) {
      throw new BadRequestError("report_target_without_account", {
        userId: targetUserId,
      });
    }
    const picture = await UserManager.getMembershipPicture(target.id);
    if (picture.instanceOwner) {
      throw new ForbiddenError("report_target_instance_owner");
    }
    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantId,
      target.id,
    );
    if (membership?.owner && !mayReportOwner) {
      throw new ForbiddenError("report_target_tenant_owner");
    }
    if (target.isSuspended) {
      throw new ConflictError("report_target_already_suspended");
    }

    const result = await ReportService._store(
      tenantId,
      { userId: target.id, name: nameOf(target) },
      { reason: trimmedReason, bookingId, by },
    );
    // Who may report the target may end its membership: the same right,
    // the same protection of the tenant owners.
    if (endMembership && membership) {
      await MembershipService.endMembership(tenantId, target.id);
    }
    return result;
  }

  /**
   * Reports addresses to the instance: from `mail` of a booking of the
   * tenant, or entered by hand without one. Each
   * address picked becomes a report of its own with the booking, if any,
   * and the reason, or is added to the open one of the tenant. An address
   * an entry of the blacklist hits already becomes none and is answered in
   * `blacklisted`; where that is every address picked, nothing is reported
   * (409). From a booking the addresses of accounts cannot be reported; by
   * hand any single address can, a member's too,
   * and whether an address has an account is not told. The guest learns
   * nothing.
   *
   * @param {Object} params
   * @param {string} params.tenantId The reporting tenant
   * @param {string} [params.bookingId] The booking reported from; without
   *   one the addresses are entered by hand
   * @param {*} params.addresses The addresses picked, of its `mail`
   * @param {*} params.reason Required
   * @param {string} params.by Who reports
   * @returns {Promise<{reports: Object[], created: boolean, blacklisted: string[]}>}
   */
  static async reportAddresses({ tenantId, bookingId, addresses, reason, by }) {
    const trimmedReason = requiredText(reason, "report_reason_required");
    const picked = [
      ...new Set(
        (Array.isArray(addresses) ? addresses : [])
          .map(normalizeUserId)
          .filter(Boolean),
      ),
    ];
    if (picked.length === 0) {
      throw new BadRequestError("report_target_required");
    }
    if (bookingId) {
      await ReportService._checkAddressesOfBooking(tenantId, bookingId, picked);
    } else {
      ReportService._checkAddressesByHand(picked);
    }

    const blacklisted = [];
    const toReport = [];
    for (const address of picked) {
      if (await BlacklistService().match(address)) blacklisted.push(address);
      else toReport.push(address);
    }
    if (toReport.length === 0) {
      throw new ConflictError("report_target_already_blacklisted", {
        addresses: blacklisted,
      });
    }

    const results = [];
    for (const address of toReport) {
      results.push(
        await ReportService._store(
          tenantId,
          { address },
          { reason: trimmedReason, bookingId, by },
        ),
      );
    }
    return {
      reports: results.map((result) => result.report),
      created: results.some((result) => result.created),
      blacklisted,
    };
  }

  /**
   * The addresses picked from a booking: all of its `mail`, none of an
   * account.
   */
  static async _checkAddressesOfBooking(tenantId, bookingId, picked) {
    const booking = await BookingManager.getBooking(
      bookingId,
      tenantId,
      DOMAIN,
    );
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }
    const ofBooking = parseEmails(booking.mail);
    const foreign = picked.filter((address) => !ofBooking.includes(address));
    if (foreign.length > 0) {
      throw new ForbiddenError("report_address_not_of_booking", {
        addresses: foreign,
      });
    }
    // The address of an account is a user, reported as such: with the
    // protection of tenant and instance owners and of a suspension.
    const ofAccounts = (await UserManager.getUsersById(picked)).map(
      (user) => user.id,
    );
    if (ofAccounts.length > 0) {
      throw new BadRequestError("report_address_of_account", {
        addresses: ofAccounts,
      });
    }
  }

  /** The addresses entered by hand: each a single address, no domain. */
  static _checkAddressesByHand(picked) {
    for (const address of picked) {
      let parsed = null;
      try {
        parsed = BlacklistService().parse(address);
      } catch {
        // Refused below, under the code of the reports.
      }
      if (parsed?.kind !== BlacklistEntryKind.ADDRESS) {
        throw new BadRequestError("report_address_invalid", { address });
      }
    }
  }

  /**
   * Stores a report about the target, a user or an address, or adds it to
   * the open one of the tenant, and tells the instance owners of a new
   * one.
   */
  static async _store(
    tenantId,
    target,
    { reason: trimmedReason, bookingId, by },
  ) {
    const targetKey = targetKeyOf(target);
    const now = Date.now();
    const evidence = {
      reason: trimmedReason,
      bookingId: bookingId ?? null,
      reportedBy: by,
      reportedAt: now,
    };
    const open = await ReportManager.getOpenReport(tenantId, targetKey);
    if (open) {
      const added = await ReportManager.addToOpenReport(open.id, evidence);
      if (added) return { report: added, created: false };
    }

    let stored;
    try {
      stored = await ReportManager.insertReport({
        id: uuidv4(),
        tenantId,
        ...targetKey,
        ...evidence,
        additions: [],
        status: REPORT_STATUS.OPEN,
        rejectionReason: null,
        resolvedAt: null,
        resolvedBy: null,
      });
    } catch (error) {
      // Opened meanwhile by a report at the same moment: add to that one.
      if (error.code !== 11000) throw error;
      const raced = await ReportManager.getOpenReport(tenantId, targetKey);
      const added =
        raced && (await ReportManager.addToOpenReport(raced.id, evidence));
      if (!added) throw error;
      return { report: added, created: false };
    }
    const tenantNames = await tenantNamesOf([tenantId]);
    await SupervisionNotificationService.recordAndDispatch({
      type: NOTIFICATION_TYPES.REPORT_CREATED,
      tenantId,
      createdAt: new Date(now),
      payload: {
        tenantName: tenantNames.get(tenantId),
        reportId: stored.id,
        ...targetKey,
        targetName: target.name ?? "",
        reason: trimmedReason,
        bookingId: stored.bookingId,
        reportedBy: by,
      },
    });
    return { report: stored, created: true };
  }

  /**
   * Adds a reason to an open report of the tenant, from its list.
   * No mail: the instance owner reads the
   * addition with the report.
   *
   * @param {Object} params
   * @param {string} params.tenantId The tenant the report must be of
   * @param {string} params.reportId
   * @param {*} params.reason Required
   * @param {string} params.by Who adds
   * @param {boolean} params.mayReportOwner As at `report`
   * @returns {Promise<Object>} The report after the addition
   */
  static async addReason({ tenantId, reportId, reason, by, mayReportOwner }) {
    const trimmedReason = requiredText(reason, "report_reason_required");
    await ReportService._ownOpenReport(tenantId, reportId, mayReportOwner);
    const added = await ReportManager.addToOpenReport(reportId, {
      reason: trimmedReason,
      bookingId: null,
      reportedBy: by,
      reportedAt: Date.now(),
    });
    if (!added) throw new ConflictError("report_not_open", { reportId });
    return added;
  }

  /**
   * Withdraws an open report of the tenant: it is
   * settled as `withdrawn`, without a mail, and a new report about the
   * target may follow.
   *
   * @param {Object} params
   * @param {string} params.tenantId The tenant the report must be of
   * @param {string} params.reportId
   * @param {string} params.by Who withdraws
   * @param {boolean} params.mayReportOwner As at `report`
   * @returns {Promise<Object>} The report withdrawn
   */
  static async withdraw({ tenantId, reportId, by, mayReportOwner }) {
    await ReportService._ownOpenReport(tenantId, reportId, mayReportOwner);
    const withdrawn = await ReportManager.closeOpenReport(reportId, {
      status: REPORT_STATUS.WITHDRAWN,
      resolvedAt: Date.now(),
      resolvedBy: by,
    });
    if (!withdrawn) throw new ConflictError("report_not_open", { reportId });
    return withdrawn;
  }

  /**
   * The reports, oldest first, each with the name of its tenant and of
   * the reported user (none for an address):
   * every tenant's for the instance owner, one tenant's own for the tenant,
   * there also whether the target is a tenant
   * owner, whose report only a tenant owner may change.
   *
   * @param {Object} [filter]
   * @param {string} [filter.status] Default: every status
   * @param {string} [filter.targetUserId]
   * @param {string} [filter.targetAddress]
   * @param {string} [filter.tenantId] Default: every tenant
   * @returns {Promise<Object[]>}
   */
  static async list({ status, targetUserId, targetAddress, tenantId } = {}) {
    const reports = await ReportManager.getReports({
      status,
      targetUserId: targetUserId ? normalizeUserId(targetUserId) : undefined,
      targetAddress: targetAddress ? normalizeUserId(targetAddress) : undefined,
      tenantId,
    });
    const tenantNames = await tenantNamesOf(
      reports.map((report) => report.tenantId),
    );
    const targets = new Map(
      (
        await UserManager.getUsersById([
          ...new Set(
            reports.map((report) => report.targetUserId).filter(Boolean),
          ),
        ])
      ).map((user) => [user.id, user]),
    );
    const owners = tenantId
      ? new Set(
          (await MembershipManager.getOwnerMembershipsByTenantID(tenantId)).map(
            (membership) => membership.userId,
          ),
        )
      : null;
    return reports.map((report) => {
      const target = targets.get(report.targetUserId);
      return {
        ...report,
        tenantName: tenantNames.get(report.tenantId),
        targetName: nameOf(target),
        targetSuspended: target?.isSuspended === true,
        ...(owners && { targetTenantOwner: owners.has(report.targetUserId) }),
      };
    });
  }

  /**
   * Settles every open report about a user or, with `address`, about an
   * address. A suspension goes the way of every
   * suspension and a blacklist entry the way of every entry, each of which
   * settles the reports; a rejection needs a reason.
   *
   * @param {Object} params
   * @param {string} [params.userId] The reported user
   * @param {string} [params.address] The reported address
   * @param {string} params.decision `suspend` for a user, `blacklist` for
   *   an address, or `reject`
   * @param {*} params.reason The reason of the suspension, the entry or
   *   the rejection
   * @param {boolean} [params.domain] With `blacklist`: the entry is the
   *   domain of the address instead of the exact address
   * @param {string} params.by The instance owner
   * @returns {Promise<Object[]>} The reports settled
   */
  static async resolve({ userId, address, decision, reason, domain, by }) {
    const byAddress = address != null;
    const decisions = byAddress
      ? [DECISIONS.BLACKLIST, DECISIONS.REJECT]
      : [DECISIONS.SUSPEND, DECISIONS.REJECT];
    if (!decisions.includes(decision)) {
      throw new BadRequestError("report_decision_invalid", { decision });
    }
    const target = byAddress
      ? { address: normalizeUserId(address) }
      : { userId: normalizeUserId(userId) };
    const targetKey = targetKeyOf(target);
    const open = await ReportManager.getReports({
      status: REPORT_STATUS.OPEN,
      ...targetKey,
    });
    if (open.length === 0) {
      throw new NotFoundError(
        "report_none_open",
        byAddress ? { address: target.address } : { userId: target.userId },
      );
    }

    let settledIds;
    if (decision === DECISIONS.SUSPEND) {
      const user = await SuspensionService().suspend(target.userId, {
        reason,
        by,
      });
      settledIds = user.suspension?.reportIds ?? [];
    } else if (decision === DECISIONS.BLACKLIST) {
      const value = domain
        ? BlacklistService().domainOf(target.address)
        : target.address;
      const entry = await BlacklistService().create({
        value,
        reason,
        by,
        fromReports: true,
      });
      // A domain settles the reports about its other addresses too.
      return (await ReportManager.getReports({ addresses: true })).filter(
        (report) => entry.reportIds?.includes(report.id),
      );
    } else {
      const rejectionReason = requiredText(
        reason,
        "report_rejection_reason_required",
      );
      return ReportService._settle(target, {
        status: REPORT_STATUS.REJECTED,
        rejectionReason,
        by,
      });
    }
    return (await ReportManager.getReports(targetKey)).filter((report) =>
      settledIds.includes(report.id),
    );
  }

  /**
   * Settles the open reports about a user as `suspended`: every
   * suspension of the user goes through here,
   * the one by a blacklist entry included.
   *
   * @param {string} userId
   * @param {string} by The instance owner who suspends
   * @returns {Promise<string[]>} The ids of the reports settled
   */
  static async settleBySuspension(userId, by) {
    const settled = await ReportService._settle(
      { userId: normalizeUserId(userId) },
      { status: REPORT_STATUS.SUSPENDED, rejectionReason: null, by },
    );
    return settled.map((report) => report.id);
  }

  /**
   * Settles the open reports about every address a new blacklist entry
   * hits as `blacklisted`: every entry goes
   * through here, by hand, as a domain, from a suspension or from reports.
   *
   * @param {Object} entry The blacklist entry as stored
   * @returns {Promise<string[]>} The ids of the reports settled
   */
  static async settleByBlacklistEntry(entry) {
    const open = await ReportManager.getReports({
      status: REPORT_STATUS.OPEN,
      addresses: true,
    });
    const hit = [
      ...new Set(
        open
          .map((report) => report.targetAddress)
          .filter((address) => BlacklistService().hits(entry, address)),
      ),
    ];
    const settledIds = [];
    for (const address of hit) {
      const settled = await ReportService._settle(
        { address },
        {
          status: REPORT_STATUS.BLACKLISTED,
          rejectionReason: null,
          by: entry.createdBy,
        },
      );
      settledIds.push(...settled.map((report) => report.id));
    }
    return settledIds;
  }

  /**
   * What a suspension of the user would settle, for its dialog: per
   * reporting tenant the number of open reports and the tenant owners who
   * then get a mail.
   *
   * @param {string} userId
   * @returns {Promise<Array<{tenantId: string, tenantName: string, reports: number, owners: string[]}>>}
   */
  static async suspensionPreview(userId) {
    const open = await ReportManager.getReports({
      status: REPORT_STATUS.OPEN,
      targetUserId: normalizeUserId(userId),
    });
    const counts = new Map();
    for (const report of open) {
      counts.set(report.tenantId, (counts.get(report.tenantId) ?? 0) + 1);
    }
    const tenantNames = await tenantNamesOf([...counts.keys()]);
    const result = [];
    for (const [tenantId, reports] of counts) {
      const owners =
        await MembershipManager.getOwnerMembershipsByTenantID(tenantId);
      result.push({
        tenantId,
        tenantName: tenantNames.get(tenantId),
        reports,
        owners: owners.map((membership) => membership.userId),
      });
    }
    return result;
  }

  /**
   * Settles the open reports about a target, a user or an address, and
   * tells the owners of each reporting tenant, one mail per tenant.
   */
  static async _settle(target, { status, rejectionReason, by }) {
    const now = Date.now();
    const targetKey = targetKeyOf(target);
    const settled = await ReportManager.resolveOpenReports(targetKey, {
      status,
      rejectionReason,
      resolvedAt: now,
      resolvedBy: by,
    });
    if (settled.length === 0) return settled;

    const user = targetKey.targetUserId
      ? await UserManager.getUser(targetKey.targetUserId)
      : null;
    const tenantNames = await tenantNamesOf(
      settled.map((report) => report.tenantId),
    );
    for (const tenantId of tenantNames.keys()) {
      await SupervisionNotificationService.recordAndDispatch({
        type: NOTIFICATION_TYPES.REPORT_RESOLVED,
        tenantId,
        createdAt: new Date(now),
        payload: {
          tenantName: tenantNames.get(tenantId),
          ...targetKey,
          targetName: nameOf(user),
          outcome: status,
          reason: rejectionReason,
          reportIds: settled
            .filter((report) => report.tenantId === tenantId)
            .map((report) => report.id),
          resolvedBy: by,
        },
      });
    }
    return settled;
  }

  /**
   * An open report of the tenant, for its own changes: another tenant's
   * is not found, one about a tenant owner is a tenant owner's alone, as
   * reporting it was.
   */
  static async _ownOpenReport(tenantId, reportId, mayReportOwner) {
    const report = await ReportManager.getReport(reportId);
    if (!report || report.tenantId !== tenantId) {
      throw new NotFoundError("report_not_found", { reportId });
    }
    if (report.status !== REPORT_STATUS.OPEN) {
      throw new ConflictError("report_not_open", { reportId });
    }
    const membership =
      report.targetUserId &&
      (await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        report.targetUserId,
      ));
    if (membership?.owner && !mayReportOwner) {
      throw new ForbiddenError("report_target_tenant_owner");
    }
    return report;
  }

  /**
   * The user a report is about: a member of the tenant, or the booker of
   * a booking of the tenant. Anybody else is not the tenant's to report.
   */
  static async _target(tenantId, { userId, bookingId }) {
    if (bookingId) {
      const booking = await BookingManager.getBooking(
        bookingId,
        tenantId,
        DOMAIN,
      );
      if (!booking) {
        throw new NotFoundError("booking_not_found", { bookingId });
      }
      const booker = normalizeUserId(booking.assignedUserId);
      if (!booker) {
        throw new BadRequestError("report_target_without_account", {
          bookingId,
        });
      }
      if (userId && normalizeUserId(userId) !== booker) {
        throw new BadRequestError("report_target_not_booker", { bookingId });
      }
      return booker;
    }

    const targetUserId = normalizeUserId(userId);
    if (!targetUserId) {
      throw new BadRequestError("report_target_required");
    }
    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantId,
      targetUserId,
    );
    if (!membership) {
      throw new ForbiddenError("report_target_not_of_tenant");
    }
    return targetUserId;
  }
}

module.exports = ReportService;
