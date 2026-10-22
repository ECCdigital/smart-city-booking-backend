const { v4: uuidv4 } = require("uuid");
const ReportManager = require("../../data-managers/report-manager");
const UserManager = require("../../data-managers/user-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const SupervisionNotificationService = require("../supervision/supervision-notification-service");
const { NOTIFICATION_TYPES } = require("../supervision/supervision-constants");
const { DOMAIN } = require("../authorization/reach");
const { REPORT_STATUS } = require("../../schemas/reportSchema");
const { normalizeUserId } = require("../../utilities/user-id-utils");
const Formatters = require("../../utilities/formatters");
const {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");

// Required on use: the suspension settles reports through this service.
const SuspensionService = () => require("../user/suspension-service");

/** The outcomes the instance owner settles open reports with. */
const DECISIONS = Object.freeze({
  SUSPEND: "suspend",
  REJECT: "reject",
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
 * The reports (glossary „Meldung (eines Users oder einer Adresse)“,
 * ECCdigital/tickets#630): a tenant reports a member or the booker of one
 * of its bookings to the instance; the instance owner settles every open
 * report about the user at once, with a suspension or a rejection with a
 * reason. The reported user learns nothing; the instance owners learn of
 * a new report and the tenant owners of each reporting tenant of the
 * outcome, both over the supervision outbox.
 */
class ReportService {
  /**
   * Reports a user to the instance. The target is a member of the tenant
   * or the booker of the booking named (`assignedUserId`, with an
   * account), seen or not; a tenant owner only by a tenant owner, an
   * instance owner by nobody. An open report of the tenant about the user
   * gets the reason added instead of a second report.
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
   * @returns {Promise<{report: Object, created: boolean}>}
   */
  static async report({
    tenantId,
    userId,
    bookingId,
    reason,
    by,
    mayReportOwner,
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

    const now = Date.now();
    const evidence = {
      reason: trimmedReason,
      bookingId: bookingId ?? null,
      reportedBy: by,
      reportedAt: now,
    };
    const open = await ReportManager.getOpenReport(tenantId, target.id);
    if (open) {
      const added = await ReportManager.addToOpenReport(open.id, evidence);
      if (added) return { report: added, created: false };
    }

    let stored;
    try {
      stored = await ReportManager.insertReport({
        id: uuidv4(),
        tenantId,
        targetUserId: target.id,
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
      const raced = await ReportManager.getOpenReport(tenantId, target.id);
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
        targetUserId: target.id,
        targetName: nameOf(target),
        reason: trimmedReason,
        bookingId: stored.bookingId,
        reportedBy: by,
      },
    });
    return { report: stored, created: true };
  }

  /**
   * The reports for the instance owner, oldest first, each with the name
   * of its tenant and of the reported user.
   *
   * @param {Object} [filter]
   * @param {string} [filter.status] Default: every status
   * @param {string} [filter.targetUserId]
   * @returns {Promise<Object[]>}
   */
  static async list({ status, targetUserId } = {}) {
    const reports = await ReportManager.getReports({
      status,
      targetUserId: targetUserId ? normalizeUserId(targetUserId) : undefined,
    });
    const tenantNames = await tenantNamesOf(
      reports.map((report) => report.tenantId),
    );
    const targets = new Map(
      (
        await UserManager.getUsersById([
          ...new Set(reports.map((report) => report.targetUserId)),
        ])
      ).map((user) => [user.id, user]),
    );
    return reports.map((report) => {
      const target = targets.get(report.targetUserId);
      return {
        ...report,
        tenantName: tenantNames.get(report.tenantId),
        targetName: nameOf(target),
        targetSuspended: target?.isSuspended === true,
      };
    });
  }

  /**
   * Settles every open report about a user. A suspension goes the way of
   * every suspension, which settles the reports; a rejection needs a
   * reason.
   *
   * @param {Object} params
   * @param {string} params.userId The reported user
   * @param {string} params.decision `suspend` or `reject`
   * @param {*} params.reason The reason of the suspension or the rejection
   * @param {string} params.by The instance owner
   * @returns {Promise<Object[]>} The reports settled
   */
  static async resolve({ userId, decision, reason, by }) {
    if (!Object.values(DECISIONS).includes(decision)) {
      throw new BadRequestError("report_decision_invalid", { decision });
    }
    const targetUserId = normalizeUserId(userId);
    const open = await ReportManager.getReports({
      status: REPORT_STATUS.OPEN,
      targetUserId,
    });
    if (open.length === 0) {
      throw new NotFoundError("report_none_open", { userId: targetUserId });
    }

    if (decision === DECISIONS.SUSPEND) {
      const user = await SuspensionService().suspend(targetUserId, {
        reason,
        by,
      });
      const settledIds = user.suspension?.reportIds ?? [];
      return (await ReportManager.getReports({ targetUserId })).filter(
        (report) => settledIds.includes(report.id),
      );
    }

    const rejectionReason = requiredText(
      reason,
      "report_rejection_reason_required",
    );
    return ReportService._settle(targetUserId, {
      status: REPORT_STATUS.REJECTED,
      rejectionReason,
      by,
    });
  }

  /**
   * Settles the open reports about a user as `suspended`: every
   * suspension of the user goes through here (ECCdigital/tickets#630).
   *
   * @param {string} userId
   * @param {string} by The instance owner who suspends
   * @returns {Promise<string[]>} The ids of the reports settled
   */
  static async settleBySuspension(userId, by) {
    const settled = await ReportService._settle(userId, {
      status: REPORT_STATUS.SUSPENDED,
      rejectionReason: null,
      by,
    });
    return settled.map((report) => report.id);
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
   * Settles the open reports about a user and tells the owners of each
   * reporting tenant, one mail per tenant.
   */
  static async _settle(userId, { status, rejectionReason, by }) {
    const now = Date.now();
    const settled = await ReportManager.resolveOpenReports(
      normalizeUserId(userId),
      { status, rejectionReason, resolvedAt: now, resolvedBy: by },
    );
    if (settled.length === 0) return settled;

    const target = await UserManager.getUser(settled[0].targetUserId);
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
          targetUserId: settled[0].targetUserId,
          targetName: nameOf(target),
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
