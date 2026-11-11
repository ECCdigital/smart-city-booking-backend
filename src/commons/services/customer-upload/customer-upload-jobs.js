const bunyan = require("bunyan");
const schedule = require("node-schedule");

const BookingManager = require("../../data-managers/booking-manager");
const MediaManager = require("../../data-managers/media-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const MediaService = require("../media/media-service");
const mailService = require("../../mail-service");
const { DOMAIN } = require("../authorization");
const {
  CUSTOMER_UPLOAD_NOTICE,
  CUSTOMER_UPLOAD_REVIEW,
} = require("../../schemas/customerUploadReferenceSchema");
const { LIVE_STATUSES } = require("../booking-lifecycle/booking-state");
const {
  effectiveCustomerUploadSettings,
  normalizeCustomerUploadSettings,
} = require("./customer-upload-rules");
const {
  isWaiting,
  missingRequiredFieldsOf,
} = require("./customer-upload-state");
const { CustomerUploadService } = require("./customer-upload-service");

const logger = bunyan.createLogger({
  name: "customer-upload-jobs.js",
  level: process.env.LOG_LEVEL,
});

const DAY = 24 * 60 * 60 * 1000;

/** Every hour, a few minutes past, away from the full hour. */
const SCHEDULE = "7 * * * *";

const LIVE = new Set(LIVE_STATUSES);

const timeOf = (value) => {
  if (value === null || value === undefined) return null;
  const time = Number(value);
  return Number.isFinite(time) ? time : null;
};

/**
 * The end of a booking for the deletion deadline of its customer uploads:
 * its end time, earlier where it was cancelled, withdrawn or rejected - the
 * moment the job first found it so. Null for a live booking without an end
 * time: it has not ended.
 */
function endOf(booking) {
  const end = timeOf(booking.timeEnd);
  if (LIVE.has(booking.status)) return end;
  const endedAt = timeOf(booking.customerUploadEndedAt);
  if (end === null) return endedAt;
  if (endedAt === null) return end;
  return Math.min(end, endedAt);
}

/**
 * The job of customer uploads, run regularly and
 * idempotent - a second run sends and deletes nothing twice:
 *
 * - Reminder: a required upload field still missing, its deadline minus the
 *   tenant's distance reached → one mail to the customer per booking.
 * - Overdue: the deadline of a required upload field passed and the field
 *   still missing → one notice „Nachweis überfällig“ to the tenant per
 *   booking, behind the tenant's switch.
 * - Deletion deadline: the end of the last booking a customer upload is
 *   handed in for, plus the tenant's deletion deadline, reached → the file
 *   is deleted, and every booking keeps the note „automatisch gelöscht“. A
 *   cancellation, withdrawal or rejection of the booking is its end.
 *
 * The booking remembers what the job sent (`customerUploadNotices`), per
 * kind and upload field, noted atomically before the mail goes: of two
 * runs at once only one sends. A mail that fails is taken off again, so
 * the next run sends it. Biletado blocks and cancels nothing for a missing
 * proof.
 */
class CustomerUploadJobs {
  /**
   * One run of the job.
   *
   * @param {Object} [options]
   * @param {number} [options.now] The clock of the run
   * @returns {Promise<{reminded: string[], overdue: string[], deleted: string[]}>}
   *   The ids of the bookings reminded and reported, and of the media deleted
   */
  static async run({ now = Date.now() } = {}) {
    const outcome = { reminded: [], overdue: [], deleted: [] };
    await CustomerUploadJobs._tell(now, outcome);
    await CustomerUploadJobs._deleteExpired(now, outcome);
    return outcome;
  }

  /**
   * Plans the job every hour; a run still going when the next is due lets
   * that one pass.
   *
   * @returns {Object} The job of `node-schedule`
   */
  static schedule() {
    let running = false;
    return schedule.scheduleJob(SCHEDULE, async () => {
      if (running) return;
      running = true;
      try {
        const outcome = await CustomerUploadJobs.run();
        logger.info(
          `customer upload job: ${outcome.reminded.length} reminded, ${outcome.overdue.length} overdue, ${outcome.deleted.length} deleted`,
        );
      } catch (error) {
        logger.error({ err: error }, "customer upload job failed");
      } finally {
        running = false;
      }
    });
  }

  /**
   * Reminders and notices „Nachweis überfällig“, per tenant with the
   * feature; none while the instance has it off. The deletion runs apart.
   */
  static async _tell(now, outcome) {
    const ofInstance = await InstanceManager.getCustomerUploads();
    if (!ofInstance.enabled) return;
    const tenants = await TenantManager.getTenants(DOMAIN);
    for (const tenant of tenants) {
      const settings = effectiveCustomerUploadSettings(
        tenant.customerUploads,
        ofInstance,
      );
      if (!settings.enabled) continue;
      try {
        await CustomerUploadJobs._tellTenant(tenant, settings, now, outcome);
      } catch (error) {
        logger.error(
          { err: error, tenantId: tenant.id },
          "customer upload job: reminders of a tenant failed",
        );
      }
    }
  }

  static async _tellTenant(tenant, settings, now, outcome) {
    // Live and not over: an upload field takes uploads only so long.
    const bookings = await BookingManager.getBookingsCustomFilter(
      tenant.id,
      {
        status: { $in: LIVE_STATUSES },
        $or: [{ timeEnd: { $gte: now } }, { timeEnd: null }],
      },
      DOMAIN,
    );
    if (bookings.length === 0) return;

    const states = await CustomerUploadService.statesOf(bookings, { now });
    const distance = settings.reminderDaysBeforeDeadline * DAY;

    for (const booking of bookings) {
      const missing = missingRequiredFieldsOf(states.get(booking.id));
      if (missing.length === 0) continue;

      const due = missing.filter(
        (field) =>
          field.deadline !== null &&
          !field.pastDeadline &&
          now >= field.deadline - distance,
      );
      if (
        await CustomerUploadJobs._notice({
          kind: CUSTOMER_UPLOAD_NOTICE.REMINDER,
          type: "CUSTOMER_UPLOAD_REMINDER",
          tenantId: tenant.id,
          booking,
          fields: due,
          now,
        })
      ) {
        outcome.reminded.push(booking.id);
      }

      if (!settings.notifyOnOverdue) continue;
      const overdue = missing.filter((field) => field.pastDeadline);
      if (
        await CustomerUploadJobs._notice({
          kind: CUSTOMER_UPLOAD_NOTICE.OVERDUE,
          type: "CUSTOMER_UPLOAD_OVERDUE",
          tenantId: tenant.id,
          booking,
          fields: overdue,
          now,
        })
      ) {
        outcome.overdue.push(booking.id);
      }
    }
  }

  /**
   * One mail of a kind for the fields of a booking not told yet: each field
   * noted at the booking first, the mail for the ones this run noted, and
   * the notes taken off again where the mail fails.
   *
   * @returns {Promise<boolean>} Whether a mail went
   */
  static async _notice({ kind, type, tenantId, booking, fields, now }) {
    const told = new Set(
      (booking.customerUploadNotices || [])
        .filter((notice) => notice.kind === kind)
        .map((notice) => notice.fieldId),
    );
    const claimed = [];
    for (const field of fields) {
      if (told.has(field.fieldId)) continue;
      const notice = { kind, fieldId: field.fieldId, sentAt: now };
      if (
        await BookingManager.claimCustomerUploadNotice(
          tenantId,
          booking.id,
          notice,
        )
      ) {
        claimed.push(field);
      }
    }
    if (claimed.length === 0) return false;

    const fieldLabels = claimed.map((field) => field.label);
    const ctx =
      type === "CUSTOMER_UPLOAD_OVERDUE"
        ? { tenantId, bookingId: booking.id, fieldLabels }
        : { tenantId, bookingIds: [booking.id], fieldLabels };
    try {
      await mailService.notify(type, ctx);
      return true;
    } catch (error) {
      logger.error(
        { err: error, tenantId, bookingId: booking.id },
        `customer upload job: ${type} could not be sent, next run again`,
      );
      for (const field of claimed) {
        await BookingManager.releaseCustomerUploadNotice(tenantId, booking.id, {
          kind,
          fieldId: field.fieldId,
        });
      }
      return false;
    }
  }

  /**
   * The deletion deadline: every customer upload whose file is still
   * stored, over all tenants - one switched off since keeps its deadline.
   */
  static async _deleteExpired(now, outcome) {
    const bookings =
      await BookingManager.getBookingsWithStoredCustomerUploads();
    if (bookings.length === 0) return;

    for (const booking of bookings) {
      await CustomerUploadJobs._markEnd(booking, now);
    }

    const tenantIds = [...new Set(bookings.map((b) => b.tenantId))];
    const tenants = await TenantManager.getTenantsByIds(tenantIds, DOMAIN);
    const retentionOf = new Map(
      tenants.map((tenant) => [
        tenant.id,
        normalizeCustomerUploadSettings(tenant.customerUploads).retentionDays,
      ]),
    );

    // The bookings each stored medium is handed in for.
    const byMedia = new Map();
    for (const booking of bookings) {
      for (const reference of booking.customerUploads || []) {
        if (!isWaiting(reference)) continue;
        const key = `${booking.tenantId}\u0000${reference.mediaId}`;
        const entry = byMedia.get(key) ?? {
          tenantId: booking.tenantId,
          mediaId: reference.mediaId,
          bookings: [],
        };
        entry.bookings.push(booking);
        byMedia.set(key, entry);
      }
    }

    for (const { tenantId, mediaId, bookings: holders } of byMedia.values()) {
      const ends = holders.map(endOf);
      if (ends.some((end) => end === null)) continue;
      const retentionDays = retentionOf.get(tenantId);
      if (retentionDays === undefined) continue;
      if (now < Math.max(...ends) + retentionDays * DAY) continue;

      try {
        await CustomerUploadJobs._deleteUpload(tenantId, mediaId, holders, now);
        outcome.deleted.push(mediaId);
      } catch (error) {
        logger.error(
          { err: error, tenantId, mediaId },
          "customer upload job: deletion by the deadline failed, next run again",
        );
      }
    }
  }

  /**
   * Notes when a booking was first found ended by cancellation, withdrawal
   * or rejection, and takes that off a booking live again.
   */
  static async _markEnd(booking, now) {
    const live = LIVE.has(booking.status);
    const endedAt = timeOf(booking.customerUploadEndedAt);
    if (!live && endedAt === null) {
      await BookingManager.setCustomerUploadEndedAt(
        booking.tenantId,
        booking.id,
        now,
      );
      booking.customerUploadEndedAt = now;
    } else if (live && endedAt !== null) {
      await BookingManager.setCustomerUploadEndedAt(
        booking.tenantId,
        booking.id,
        null,
      );
      booking.customerUploadEndedAt = null;
    }
  }

  /**
   * The file first, then the note at every booking: a run that stops in
   * between finds the reference still waiting and finishes it.
   */
  static async _deleteUpload(tenantId, mediaId, holders, now) {
    const media = await MediaManager.getMedia(mediaId, tenantId, DOMAIN);
    if (media) {
      await MediaService.deleteMedia(media);
    }
    const note = {
      status: CUSTOMER_UPLOAD_REVIEW.SUBMITTED,
      reason: "",
      reviewedAt: null,
      reviewedBy: null,
      reviewedByName: "",
      autoDeleted: true,
      fileDeletedAt: now,
    };
    for (const booking of holders) {
      await BookingManager.reviewCustomerUpload(
        tenantId,
        booking.id,
        mediaId,
        note,
      );
    }
    logger.info(
      `${tenantId} -- customer upload ${mediaId} deleted by the deadline for bookings ${holders.map((b) => b.id).join(", ")}`,
    );
  }
}

module.exports = { CustomerUploadJobs, endOf };
