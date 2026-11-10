const bunyan = require("bunyan");

const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const MediaManager = require("../../data-managers/media-manager");
const UserManager = require("../../data-managers/user-manager");
const MediaService = require("../media/media-service");
const mailService = require("../../mail-service");
const { DOMAIN } = require("../authorization");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");
const {
  CUSTOMER_UPLOAD_REVIEW,
} = require("../../schemas/customerUploadReferenceSchema");
const {
  CUSTOMER_UPLOAD_REASONS,
  CustomerUploadService,
} = require("./customer-upload-service");
const {
  FIELD_STATE,
  REOPEN_KIND,
  fieldStateOf,
  isWaiting,
} = require("./customer-upload-state");

const logger = bunyan.createLogger({
  name: "customer-upload-review.js",
  level: process.env.LOG_LEVEL,
});

const R = CUSTOMER_UPLOAD_REASONS;

/** The reasons a check or „Erneut anfordern“ is refused for. */
const REVIEW_REASONS = Object.freeze({
  RESULT_INVALID: "customer_upload_review_result_invalid",
  REASON_MISSING: "customer_upload_reason_missing",
  REASON_TOO_LONG: "customer_upload_reason_too_long",
  FIELD_NOT_REVIEWED: "customer_upload_field_not_reviewed",
});

const MAX_REASON_LENGTH = 500;

const isPending = isWaiting;

/**
 * The name of the staff member as the note keeps it: first and last name
 * of the account (the signed-in user of a request carries its id alone),
 * the id where the account has none.
 */
async function nameOf(user) {
  if (!user?.id) return "";
  const account = await UserManager.getUser(user.id);
  const name = [account?.firstName, account?.lastName]
    .filter((part) => part && String(part).trim())
    .join(" ")
    .trim();
  return name || user.id;
}

/** A reason, trimmed; required where `required`. */
function reasonOf(value, { required }) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (required && !reason) {
    throw new BadRequestError(REVIEW_REASONS.REASON_MISSING);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new BadRequestError(REVIEW_REASONS.REASON_TOO_LONG, {
      maxLength: MAX_REASON_LENGTH,
    });
  }
  return reason;
}

/**
 * The check of a customer upload by the staff (glossary „Prüfung“):
 * accept it, or reject it with a reason. Every
 * result deletes the file at once and leaves a note without content at
 * every booking the upload is handed in for - a field „besonders
 * schutzwürdig“ the same, whatever else at the booking still waits. There
 * is no taking back: a checked field is opened again by „Erneut
 * anfordern“, with a reason.
 *
 * A rejection and „Erneut anfordern“ tell the customer by mail - the
 * reason and the way to hand in anew, never the file - one mail for the
 * bookings of a group. Accepting tells nobody.
 */
class CustomerUploadReview {
  /**
   * Checks a customer upload of a booking.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookingId
   * @param {string} params.fieldId
   * @param {string} params.mediaId
   * @param {string} params.result `accepted` or `rejected`
   * @param {string} [params.reason] Required for a rejection
   * @param {string[]} [params.alsoFor] An upload of a group: the other
   *   bookings holding it the check counts for too;
   *   all of them without. The file stays for the ones left out, waiting
   *   for their own check, and goes with the last one checked.
   * @param {Object} params.user The staff member
   * @param {number} [params.now]
   * @returns {Promise<string[]>} The ids of the bookings that got the note
   */
  static async review({
    tenantId,
    bookingId,
    fieldId,
    mediaId,
    result,
    reason,
    alsoFor = null,
    user,
    now = Date.now(),
  }) {
    if (
      result !== CUSTOMER_UPLOAD_REVIEW.ACCEPTED &&
      result !== CUSTOMER_UPLOAD_REVIEW.REJECTED
    ) {
      throw new BadRequestError(REVIEW_REASONS.RESULT_INVALID);
    }
    const why = reasonOf(reason, {
      required: result === CUSTOMER_UPLOAD_REVIEW.REJECTED,
    });

    const booking = await CustomerUploadReview._booking(tenantId, bookingId);
    const reference = (booking.customerUploads || []).find(
      (r) => r.mediaId === mediaId && r.fieldId === fieldId,
    );
    if (!reference) {
      throw new NotFoundError(R.UPLOAD_NOT_FOUND, { mediaId });
    }
    if (!isPending(reference)) {
      throw new ConflictError(R.ALREADY_REVIEWED, { mediaId });
    }

    const media = await MediaManager.getMedia(mediaId, tenantId, DOMAIN);
    const holding = (media?.bookingIds || []).filter((id) => id !== bookingId);
    if (
      alsoFor !== null &&
      (!Array.isArray(alsoFor) || alsoFor.some((id) => !holding.includes(id)))
    ) {
      throw new BadRequestError(R.TARGET_INVALID, { mediaId });
    }
    const others = alsoFor === null ? holding : [...new Set(alsoFor)];
    const left = holding.filter((id) => !others.includes(id));

    const note = {
      status: result,
      reason: why,
      reviewedAt: now,
      reviewedBy: user?.id ?? null,
      reviewedByName: await nameOf(user),
      autoDeleted: false,
      fileDeletedAt: now,
    };

    // The booking of the request first: of two checks at once only the
    // first one gets through.
    const first = await BookingManager.reviewCustomerUpload(
      tenantId,
      bookingId,
      mediaId,
      note,
    );
    if (!first) {
      throw new ConflictError(R.ALREADY_REVIEWED, { mediaId });
    }
    const reviewed = [bookingId];
    for (const otherId of others) {
      if (
        await BookingManager.reviewCustomerUpload(
          tenantId,
          otherId,
          mediaId,
          note,
        )
      ) {
        reviewed.push(otherId);
      }
    }

    // The file goes at once, whatever its category and whatever else at
    // the booking still waits for its check - for the bookings checked: one
    // of the group left out keeps it for its own check.
    if (media && left.length === 0) {
      await MediaService.deleteMedia(media);
    } else if (media) {
      for (const id of reviewed) {
        await MediaManager.removeBookingReference(mediaId, tenantId, id);
      }
    }

    logger.info(
      `${tenantId} -- customer upload ${mediaId} ${result} for bookings ${reviewed.join(", ")}, ${
        left.length ? `kept for ${left.join(", ")}` : "file deleted"
      }`,
    );

    if (result === CUSTOMER_UPLOAD_REVIEW.REJECTED) {
      await CustomerUploadReview._tell(tenantId, reviewed, {
        kind: REOPEN_KIND.REJECTED,
        reason: why,
        fieldLabels: [reference.fieldLabel].filter(Boolean),
        fieldId,
      });
    }
    return reviewed;
  }

  /**
   * „Erneut anfordern“ of a fulfilled upload field: it is open again, the
   * notes of its checked uploads stay. A field waiting for its check or
   * already open again is refused (`customer_upload_field_not_reviewed`).
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookingId
   * @param {string} params.fieldId
   * @param {string} params.reason Required
   * @param {Object} params.user The staff member
   * @param {number} [params.now]
   * @returns {Promise<void>}
   */
  static async requestAgain({
    tenantId,
    bookingId,
    fieldId,
    reason,
    user,
    now = Date.now(),
  }) {
    const why = reasonOf(reason, { required: true });
    const booking = await CustomerUploadReview._booking(tenantId, bookingId);

    const references = (booking.customerUploads || []).filter(
      (r) => r.fieldId === fieldId,
    );
    // Only a fulfilled field: one already open again asks for nothing new.
    const requests = (booking.customerUploadRequests || []).filter(
      (r) => r.fieldId === fieldId,
    );
    if (
      fieldStateOf(references, null, now, requests) !== FIELD_STATE.FULFILLED
    ) {
      throw new ConflictError(REVIEW_REASONS.FIELD_NOT_REVIEWED, { fieldId });
    }

    const fieldLabel =
      [...references].reverse().find((r) => r.fieldLabel)?.fieldLabel ?? "";
    const added = await BookingManager.addCustomerUploadRequest(
      tenantId,
      bookingId,
      {
        fieldId,
        fieldLabel,
        reason: why,
        requestedAt: now,
        requestedBy: user?.id ?? null,
        requestedByName: await nameOf(user),
      },
    );
    if (!added) {
      throw new NotFoundError(R.BOOKING_NOT_FOUND, { bookingId });
    }

    logger.info(
      `${tenantId} -- customer upload field ${fieldId} of booking ${bookingId} requested again`,
    );

    await CustomerUploadReview._tell(tenantId, [bookingId], {
      kind: REOPEN_KIND.REQUESTED_AGAIN,
      reason: why,
      fieldLabels: [fieldLabel].filter(Boolean),
      fieldId,
    });
  }

  /**
   * The derived state of a booking after a check, for the staff: the
   * reviewers' names included.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @returns {Promise<Object|null>}
   */
  static async stateOf(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(
      bookingId,
      tenantId,
      DOMAIN,
    );
    if (!booking) return null;
    const states = await CustomerUploadService.statesOf([booking], {
      withReviewer: true,
    });
    return states.get(booking.id) ?? null;
  }

  static async _booking(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(
      bookingId,
      tenantId,
      DOMAIN,
    );
    if (!booking) {
      throw new NotFoundError(R.BOOKING_NOT_FOUND, { bookingId });
    }
    return booking;
  }

  /**
   * The mail to the customer: one for the bookings of a group, one per
   * booking otherwise. A mail that fails is logged; the check stands.
   */
  static async _tell(
    tenantId,
    bookingIds,
    { kind, reason, fieldLabels, fieldId },
  ) {
    const notices = [];
    const loose = [];
    const groups = new Map();
    for (const bookingId of bookingIds) {
      const group = await GroupBookingManager.getGroupBookingByBookingId(
        tenantId,
        bookingId,
        false,
        DOMAIN,
      );
      if (group) {
        const ids = groups.get(group.id) ?? [];
        ids.push(bookingId);
        groups.set(group.id, ids);
      } else {
        loose.push(bookingId);
      }
    }
    for (const [groupBookingId, ids] of groups) {
      if (ids.length > 1) {
        notices.push({ bookingIds: ids, groupBookingId });
      } else {
        loose.push(ids[0]);
      }
    }
    for (const bookingId of loose) {
      notices.push({ bookingIds: [bookingId] });
    }

    for (const notice of notices) {
      try {
        await mailService.notify("CUSTOMER_UPLOAD_REOPENED", {
          tenantId,
          ...notice,
          kind,
          reason,
          fieldLabels,
          fieldId,
        });
      } catch (error) {
        logger.error(
          { err: error, tenantId, bookingIds: notice.bookingIds },
          "Mail about a customer upload to hand in anew could not be sent",
        );
      }
    }
  }
}

module.exports = { CustomerUploadReview, REVIEW_REASONS };
