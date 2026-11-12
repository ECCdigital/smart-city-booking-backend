const {
  CUSTOMER_UPLOAD_REVIEW,
} = require("../../schemas/customerUploadReferenceSchema");
const { STATUS } = require("../booking-lifecycle/booking-state");
const {
  FILES_PER_FIELD,
  UPLOAD_FIELD_TIMINGS,
  isSensitiveUpload,
} = require("./customer-upload-rules");

/**
 * The derived state of customer uploads: read
 * off the upload fields of the booked offers and the references the booking
 * holds, never stored. Pure, so the booking answers, the storefront's pages
 * and later the jobs read one rule.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * A time of a booking as a number: a stored booking carries its times as
 * MongoDB `Double`, which `Number.isFinite` does not take as one.
 *
 * @returns {number|null}
 */
function timeOf(value) {
  if (value === null || value === undefined) return null;
  const time = Number(value);
  return Number.isFinite(time) ? time : null;
}

/** The state of one upload field. */
const FIELD_STATE = Object.freeze({
  OPEN: "open",
  SUBMITTED: "submitted",
  REJECTED: "rejected",
  OVERDUE: "overdue",
  FULFILLED: "fulfilled",
});

/**
 * The state of a booking over its required upload fields, from the least
 * to the most favourable; null without required fields.
 */
const BOOKING_STATE = Object.freeze({
  OVERDUE: "overdue",
  MISSING: "missing",
  TO_REVIEW: "toReview",
  FULFILLED: "fulfilled",
});

const BOOKING_STATE_ORDER = [
  BOOKING_STATE.OVERDUE,
  BOOKING_STATE.MISSING,
  BOOKING_STATE.TO_REVIEW,
  BOOKING_STATE.FULFILLED,
];

/** States in which a customer may hand in uploads at all. */
const LIVE_STATES = new Set([
  STATUS.REQUESTED,
  STATUS.PAYMENT_DUE,
  STATUS.CONFIRMED,
]);

/**
 * Whether an upload field takes uploads for a booking: a field of the
 * checkout and one "before the release" from the booking on, a field "after
 * the confirmation" once the booking is confirmed, each until the booking
 * has ended. A booking without a request (`autoCommitBooking`) is never
 * `requested`, so its fields are open from the booking on - a field before
 * the release then holds nothing back.
 *
 * @param {Object} field An upload field of a bookable
 * @param {Object} booking
 * @param {number} [now]
 * @returns {boolean}
 */
function isFieldOpen(field, booking, now = Date.now()) {
  if (!LIVE_STATES.has(booking.status)) return false;
  const end = timeOf(booking.timeEnd);
  if (end !== null && now > end) return false;
  if (field.timing === UPLOAD_FIELD_TIMINGS.AFTER_CONFIRMATION) {
    return booking.status !== STATUS.REQUESTED;
  }
  return true;
}

/**
 * The deadline of an upload field for a booking: its days before the start,
 * the start itself without them; null for a booking without a start. A
 * field before the release has none: it is due with the release, which has
 * no date - so it is never overdue and the job reminds of it never; the
 * staff asks for it from the release („Nachweise anfordern“).
 *
 * @param {Object} field
 * @param {Object} booking
 * @returns {number|null} Epoch milliseconds
 */
function deadlineOf(field, booking) {
  if (field.timing === UPLOAD_FIELD_TIMINGS.BEFORE_RELEASE) return null;
  const begin = timeOf(booking.timeBegin);
  if (begin === null) return null;
  const days =
    field.timing === UPLOAD_FIELD_TIMINGS.AFTER_CONFIRMATION
      ? field.deadlineDaysBeforeStart ?? 0
      : 0;
  return begin - days * DAY;
}

const reviewOf = (reference) =>
  reference.review?.status ?? CUSTOMER_UPLOAD_REVIEW.SUBMITTED;

/**
 * Whether a customer upload waits for its check: handed in, not checked,
 * and its file still stored - the deletion deadline deletes an unchecked
 * file too, and leaves a note.
 *
 * @param {Object} reference
 * @returns {boolean}
 */
const isWaiting = (reference) =>
  reviewOf(reference) === CUSTOMER_UPLOAD_REVIEW.SUBMITTED &&
  timeOf(reference.review?.fileDeletedAt) === null;

/** The kinds a checked field is opened again by. */
const REOPEN_KIND = Object.freeze({
  REJECTED: "rejected",
  REQUESTED_AGAIN: "requestedAgain",
});

/**
 * What opened the field again and is not answered yet: a rejection or
 * „Erneut anfordern“, each answered by an upload handed in after it and
 * accepted („bis Ersatz akzeptiert ist“). Each
 * accepted upload answers one of them, the earliest it came after.
 *
 * @param {Object[]} references The booking's references of the field
 * @param {Object[]} requests The booking's „Erneut anfordern“ of the field
 * @returns {Object[]} The open ones, oldest first, each `{ kind, reason, at }`
 */
function openReopensOf(references, requests) {
  const reopens = [
    ...references
      .filter((r) => reviewOf(r) === CUSTOMER_UPLOAD_REVIEW.REJECTED)
      .map((r) => ({
        kind: REOPEN_KIND.REJECTED,
        reason: r.review?.reason ?? "",
        at: timeOf(r.review?.reviewedAt) ?? 0,
      })),
    ...requests.map((request) => ({
      kind: REOPEN_KIND.REQUESTED_AGAIN,
      reason: request.reason ?? "",
      at: timeOf(request.requestedAt) ?? 0,
    })),
  ].sort((a, b) => a.at - b.at);

  const replacements = references
    .filter((r) => reviewOf(r) === CUSTOMER_UPLOAD_REVIEW.ACCEPTED)
    .map((r) => timeOf(r.uploadedAt) ?? 0)
    .sort((a, b) => a - b);

  return reopens.filter((reopen) => {
    const index = replacements.findIndex(
      (uploadedAt) => uploadedAt > reopen.at,
    );
    if (index === -1) return true;
    replacements.splice(index, 1);
    return false;
  });
}

/**
 * The state of one upload field from its references.
 *
 * A field is fulfilled once its uploads are accepted: at least one, and
 * every rejection and „Erneut anfordern“ answered by a replacement accepted
 * after it; accepted notes keep counting. A
 * rejection or „Erneut anfordern“ not answered yet opens it again. An upload
 * waiting for its check wins over everything: there is something to check.
 *
 * @param {Object[]} references The booking's references of this field
 * @param {number|null} deadline
 * @param {number} now
 * @param {Object[]} [requests] The booking's „Erneut anfordern“ of the field
 * @returns {string} One of {@link FIELD_STATE}
 */
function fieldStateOf(references, deadline, now, requests = []) {
  if (references.some(isWaiting)) {
    return FIELD_STATE.SUBMITTED;
  }
  if (openReopensOf(references, requests).length > 0) {
    return FIELD_STATE.REJECTED;
  }
  if (references.some((r) => reviewOf(r) === CUSTOMER_UPLOAD_REVIEW.ACCEPTED)) {
    return FIELD_STATE.FULFILLED;
  }
  if (deadline !== null && now > deadline) {
    return FIELD_STATE.OVERDUE;
  }
  return FIELD_STATE.OPEN;
}

/**
 * How a required field counts for its booking.
 *
 * @param {string} state One of {@link FIELD_STATE}
 * @param {boolean} pastDeadline
 * @returns {string} One of {@link BOOKING_STATE}
 */
function bookingStateOfField(state, pastDeadline) {
  switch (state) {
    case FIELD_STATE.FULFILLED:
      return BOOKING_STATE.FULFILLED;
    case FIELD_STATE.SUBMITTED:
      return BOOKING_STATE.TO_REVIEW;
    case FIELD_STATE.OVERDUE:
      return BOOKING_STATE.OVERDUE;
    default:
      return pastDeadline ? BOOKING_STATE.OVERDUE : BOOKING_STATE.MISSING;
  }
}

/**
 * A reference as the booking answers carry it: no storage detail, no
 * uploader. Once checked it is a note without content (glossary
 * „Vermerk“): the file and its name are gone. The reviewer's name only
 * for the staff.
 *
 * An upload of a group handed in for several bookings names the others
 * under `alsoFor`: while it waits for its check
 * those that still hold the medium (`holders`), so the staff sees what a
 * check counts for; once checked those it was handed in for.
 */
function exportReference(
  reference,
  { withReviewer = false, bookingId = null, holders = null, times = null } = {},
) {
  const review = {
    status: reviewOf(reference),
    reason: reference.review?.reason ?? "",
    reviewedAt: timeOf(reference.review?.reviewedAt),
    autoDeleted: Boolean(reference.review?.autoDeleted),
    // A checked normal upload keeps its file.
    fileDeleted: timeOf(reference.review?.fileDeletedAt) !== null,
  };
  if (withReviewer) {
    review.reviewedByName = reference.review?.reviewedByName ?? "";
  }
  const exported = {
    mediaId: reference.mediaId,
    fieldLabel: reference.fieldLabel,
    // Whether the file goes with the check and by the deletion deadline.
    category: isSensitiveUpload(reference) ? "sensitive" : "normal",
    originalFileName: reference.originalFileName,
    mimeType: reference.mimeType,
    size: reference.size,
    uploadedAt: timeOf(reference.uploadedAt),
    review,
  };
  const alsoFor = alsoForOf(reference, { bookingId, holders, times });
  if (alsoFor.length > 0) {
    exported.alsoFor = alsoFor;
  }
  return exported;
}

/**
 * The other bookings and fields an upload of a group counts for: of those
 * it was handed in for, while it waits only those still holding the medium.
 * Each with the time of its booking where it is known (`times`).
 */
function alsoForOf(reference, { bookingId, holders, times }) {
  const shared = reference.sharedWith || [];
  if (shared.length === 0) return [];
  const live =
    isWaiting(reference) && holders?.has(reference.mediaId)
      ? new Set(holders.get(reference.mediaId))
      : null;
  return shared
    .filter((target) => target.bookingId !== bookingId)
    .filter((target) => !live || live.has(target.bookingId))
    .map((target) => ({
      bookingId: target.bookingId,
      fieldId: target.fieldId,
      fieldLabel: target.fieldLabel ?? "",
      timeBegin: timeOf(times?.get(target.bookingId)?.timeBegin),
      timeEnd: timeOf(times?.get(target.bookingId)?.timeEnd),
    }));
}

/** „Erneut anfordern“ as the booking answers carry it. */
function exportRequest(request, { withReviewer = false } = {}) {
  const exported = {
    fieldLabel: request.fieldLabel ?? "",
    reason: request.reason ?? "",
    requestedAt: timeOf(request.requestedAt),
  };
  if (withReviewer) {
    exported.requestedByName = request.requestedByName ?? "";
  }
  return exported;
}

/**
 * The upload fields of the booked offers, each once: those the offer had
 * when it was booked, as the item's snapshot (`_bookableUsed`) keeps them.
 * A field added to the offer later is not asked of the booking, one changed
 * or deleted later counts as it was. A snapshot without upload fields - a
 * booking from before them - has none. Only an item without a snapshot
 * reads the current offer.
 *
 * @param {Object} booking
 * @param {Map<string, Object>|Object} bookablesById The current bookables
 * @returns {Object[]}
 */
function uploadFieldsOf(booking, bookablesById) {
  const get = (id) =>
    bookablesById instanceof Map ? bookablesById.get(id) : bookablesById[id];
  const fields = new Map();
  for (const item of booking.bookableItems || []) {
    const definitions = item._bookableUsed
      ? item._bookableUsed.uploadFieldDefinitions
      : get(item.bookableId)?.uploadFieldDefinitions;
    for (const field of definitions || []) {
      if (field?.id && !fields.has(field.id)) {
        fields.set(field.id, field);
      }
    }
  }
  return [...fields.values()];
}

/**
 * An edit of a booking keeps, for each offer booked before, the upload
 * fields it had when it was booked: the edit takes the offer anew, the
 * fields asked of the booking stay. An offer new to the booking brings its
 * current ones.
 *
 * @param {Object} oldBooking The booking before the edit
 * @param {Object} booking The edited booking, changed in place
 */
function keepBookedUploadFields(oldBooking, booking) {
  const booked = new Map();
  for (const item of oldBooking.bookableItems || []) {
    if (item?._bookableUsed && !booked.has(item.bookableId)) {
      booked.set(
        item.bookableId,
        item._bookableUsed.uploadFieldDefinitions ?? [],
      );
    }
  }
  for (const item of booking.bookableItems || []) {
    if (item?._bookableUsed && booked.has(item.bookableId)) {
      item._bookableUsed.uploadFieldDefinitions = booked.get(item.bookableId);
    }
  }
}

/**
 * The derived state of the customer uploads of a booking: each open upload
 * field with its state, deadline and references, and the state of the
 * booking over the required ones. The references of fields not shown -
 * renamed away, deleted at the bookable, closed - stand under
 * `otherFields`, each under the label it had at the upload, so their notes
 * stay readable.
 *
 * @param {Object} params
 * @param {Object} params.booking
 * @param {Object[]} params.fields The upload fields of the booked offers
 * @param {Object} params.settings The tenant's normalized settings
 * @param {{maxFileSizeMb: number}} params.limits The instance limits
 * @param {number} [params.now]
 * @param {boolean} [params.withReviewer] Whether the names of the
 *   reviewers go along - for the staff, not the customer
 * @param {Map<string, string[]>} [params.holders] The bookings that still
 *   hold each medium of an upload of a group, by media id
 * @param {Map<string, {timeBegin: number, timeEnd: number}>} [params.times]
 *   The times of the other bookings an upload of a group counts for
 * @returns {{state: string|null, fields: Object[], otherFields: Object[],
 *   retentionDays: number|null}} `retentionDays`: the tenant's deletion
 *   deadline for sensitive uploads, for the notice before their download
 */
function deriveCustomerUploadState({
  booking,
  fields,
  settings,
  limits,
  now = Date.now(),
  withReviewer = false,
  holders = null,
  times = null,
}) {
  const references = booking.customerUploads || [];
  const requests = booking.customerUploadRequests || [];
  const options = { withReviewer, bookingId: booking.id, holders, times };

  const shown = settings?.enabled
    ? fields.filter((field) => isFieldOpen(field, booking, now))
    : [];

  const derived = shown.map((field) => {
    const own = references.filter((r) => r.fieldId === field.id);
    const ownRequests = requests.filter((r) => r.fieldId === field.id);
    const deadline = deadlineOf(field, booking);
    const state = fieldStateOf(own, deadline, now, ownRequests);
    const pending = own.filter(isWaiting).length;
    const reopens = openReopensOf(own, ownRequests);
    return {
      fieldId: field.id,
      label: field.label,
      hint: field.hint ?? "",
      consentText: field.consentText ?? "",
      required: Boolean(field.required),
      category: field.category ?? "normal",
      maxFiles: FILES_PER_FIELD,
      formats: field.formats,
      maxFileSizeMb: Math.min(
        field.maxFileSizeMb ?? limits.maxFileSizeMb,
        limits.maxFileSizeMb,
      ),
      timing: field.timing,
      deadline,
      pastDeadline: deadline !== null && now > deadline,
      state,
      // What opened the field again, the latest one not answered yet.
      reopen: reopens.length ? reopens[reopens.length - 1] : null,
      // Room for more files: what waits for its check counts, what is
      // checked does not - its file is gone.
      remainingFiles: Math.max(0, FILES_PER_FIELD - pending),
      uploads: own.map((r) => exportReference(r, options)),
      requests: ownRequests.map((r) => exportRequest(r, options)),
    };
  });

  const shownIds = new Set(derived.map((field) => field.fieldId));
  const others = new Map();
  for (const reference of references) {
    if (shownIds.has(reference.fieldId)) continue;
    const other = others.get(reference.fieldId) ?? {
      fieldId: reference.fieldId,
      label: "",
      uploads: [],
      requests: [],
    };
    other.label = reference.fieldLabel || other.label;
    other.uploads.push(exportReference(reference, options));
    others.set(reference.fieldId, other);
  }
  for (const request of requests) {
    const other = others.get(request.fieldId);
    if (other) other.requests.push(exportRequest(request, options));
  }

  const retentionDays = Number.isInteger(settings?.retentionDays)
    ? settings.retentionDays
    : null;

  if (!settings?.enabled) {
    return {
      state: null,
      fields: [],
      otherFields: [...others.values()],
      retentionDays,
    };
  }

  const requiredStates = derived
    .filter((field) => field.required)
    .map((field) => bookingStateOfField(field.state, field.pastDeadline));
  const state =
    BOOKING_STATE_ORDER.find((candidate) =>
      requiredStates.includes(candidate),
    ) ?? null;

  return {
    state,
    fields: derived,
    otherFields: [...others.values()],
    retentionDays,
  };
}

/** The states of a field that still wants a file from the customer. */
const MISSING_FIELD_STATES = new Set([
  FIELD_STATE.OPEN,
  FIELD_STATE.REJECTED,
  FIELD_STATE.OVERDUE,
]);

/**
 * The required upload fields of a derived state the customer still has to
 * hand in: open, rejected or overdue - not what
 * waits for its check and not what is checked. None without a state.
 *
 * @param {{fields: Object[]}|null} state Of {@link deriveCustomerUploadState}
 * @returns {Object[]} The derived fields, in their order
 */
function missingRequiredFieldsOf(state) {
  return (state?.fields || []).filter(
    (field) => field.required && MISSING_FIELD_STATES.has(field.state),
  );
}

module.exports = {
  BOOKING_STATE,
  FIELD_STATE,
  REOPEN_KIND,
  deadlineOf,
  deriveCustomerUploadState,
  fieldStateOf,
  isFieldOpen,
  isWaiting,
  keepBookedUploadFields,
  missingRequiredFieldsOf,
  uploadFieldsOf,
};
