const bunyan = require("bunyan");
const sharp = require("sharp");

const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const MediaManager = require("../../data-managers/media-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const MediaService = require("../media/media-service");
const mailService = require("../../mail-service");
const RateLimiter = require("../rate-limit/rate-limiter");
const limits = require("../rate-limit/limits");
const { DOMAIN, REACH } = require("../authorization");
const { detectUploadType } = require("../media/media-file-type");
const { imageMaxPixels } = require("../media/media-config");
const {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} = require("../../../errors/BaseError");
const {
  CUSTOMER_UPLOAD_REVIEW,
} = require("../../schemas/customerUploadReferenceSchema");
const {
  UPLOAD_FIELD_TIMINGS,
  customerUploadLimits,
  normalizeCustomerUploadSettings,
} = require("./customer-upload-rules");
const {
  deriveCustomerUploadState,
  isFieldOpen,
  isWaiting,
  uploadFieldsOf,
} = require("./customer-upload-state");
const { ScannerUnavailableError, virusScanner } = require("./virus-scanner");

const logger = bunyan.createLogger({
  name: "customer-upload-service.js",
  level: process.env.LOG_LEVEL,
});

const MEGABYTE = 1024 * 1024;

/** The formats of an upload field by the type detected from the content. */
const FORMAT_OF_MIME_TYPE = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
});

/**
 * The reasons a customer upload is refused for,
 * each with its own code the storefront shows.
 */
const CUSTOMER_UPLOAD_REASONS = Object.freeze({
  BOOKING_NOT_FOUND: "booking_not_found",
  FIELD_NOT_FOUND: "customer_upload_field_not_found",
  UPLOAD_NOT_FOUND: "customer_upload_not_found",
  NOT_OPEN: "customer_upload_not_open",
  ALREADY_REVIEWED: "customer_upload_already_reviewed",
  FILE_MISSING: "customer_upload_file_missing",
  FORMAT: "customer_upload_format_not_allowed",
  SIZE: "customer_upload_too_large",
  FIELD_FULL: "customer_upload_field_full",
  BOOKING_LIMIT: "customer_upload_booking_limit",
  VIRUS_FOUND: "customer_upload_virus_found",
  SCANNER_UNAVAILABLE: "customer_upload_scanner_unavailable",
  RATE_LIMITED: "customer_upload_rate_limited",
  // A required upload field of the checkout without a file.
  REQUIRED_MISSING: "customer_upload_required_missing",
  // An upload of a group for other bookings: a
  // booking or field that is not one of the group's, one named twice, or
  // a choice a guest does not have.
  TARGET_INVALID: "customer_upload_target_invalid",
});

const R = CUSTOMER_UPLOAD_REASONS;

const isPending = isWaiting;

/**
 * The reference a booking holds of a stored customer upload. An upload of a
 * group handed in for several bookings names all of them in `sharedWith`.
 */
const referenceOf = (media, field, uploadedBy, sharedWith = []) => ({
  source: "media",
  mediaId: media.id,
  url: null,
  fieldId: field.id,
  fieldLabel: field.label,
  originalFileName: media.originalFileName,
  mimeType: media.mimeType,
  size: media.size,
  uploadedAt: Date.now(),
  uploadedBy,
  sharedWith,
  review: {
    status: CUSTOMER_UPLOAD_REVIEW.SUBMITTED,
    reason: "",
    reviewedAt: null,
    reviewedBy: null,
  },
});

/** The `sharedWith` of the references of an upload for some targets. */
const sharedWithOf = (targets) =>
  targets.length > 1
    ? targets.map(({ booking, field }) => ({
        bookingId: booking.id,
        fieldId: field.id,
        fieldLabel: field.label,
      }))
    : [];

/** What a booking holds already: the files still stored, and their bytes. */
function countsOf(booking, fieldId, { replacing = null } = {}) {
  const stored = (booking.customerUploads || []).filter(
    (reference) => isPending(reference) && reference.mediaId !== replacing,
  );
  return {
    inField: stored.filter((r) => r.fieldId === fieldId).length,
    inBooking: stored.length,
    bytesInBooking: stored.reduce((sum, r) => sum + (r.size || 0), 0),
  };
}

/**
 * The one place a customer upload comes in (glossary "Kunden-Upload"): the
 * customer hands it in later on the page „Nachweise einreichen“, or with the
 * checkout. Every file runs through the same steps,
 * in this order, and the first one that fails stores nothing:
 *
 *   rights and booking → rate limit → size of the original against field
 *   and instance → number against field and booking (stored files only)
 *   → type by the content against the field's formats → clamd (INSTREAM)
 *   → an image encoded anew without EXIF and GPS → stored encrypted →
 *   the reference at the booking.
 *
 * Handing in later, the first two run before the body is parsed (`admit`),
 * so nobody without a booking makes the server read a file. At the
 * checkout the booking is the one being made: every file of the request
 * passes every check before the first one is stored, and the references go
 * into the booking before it is stored (`acceptAtCheckout`).
 */
class CustomerUploadService {
  /**
   * Rights and booking, then the rate limit: what the routes check before
   * a byte of the file is read.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookingId
   * @param {string} params.fieldId
   * @param {string} params.userId The signed-in customer
   * @param {string} params.ip
   * @param {boolean} [params.forUpload] Whether a file comes: the field must
   *   exist and take uploads; a deletion only needs the booking
   * @returns {Promise<Object>} The context of the request
   */
  static async admit({
    tenantId,
    bookingId,
    fieldId,
    userId,
    ip,
    forUpload = true,
  }) {
    // The booking person's own booking alone, whoever asks.
    const booking = await BookingManager.getBooking(bookingId, tenantId, {
      reach: REACH.OWN,
      userId,
    });
    if (!booking) {
      throw new NotFoundError(R.BOOKING_NOT_FOUND, { bookingId });
    }
    return CustomerUploadService._admitTo(booking, {
      fieldId,
      userId,
      ip,
      forUpload,
    });
  }

  /** The field and the rate limit at an admitted booking. */
  static async _admitTo(booking, { fieldId, userId, ip, forUpload }) {
    const tenantId = booking.tenantId;
    const bookingId = booking.id;
    const context = { tenantId, booking, fieldId, userId };

    if (forUpload) {
      const { settings, fields } =
        await CustomerUploadService._fieldsOf(booking);
      const field = settings.enabled
        ? fields.find((candidate) => candidate.id === fieldId)
        : null;
      if (!field) {
        throw new NotFoundError(R.FIELD_NOT_FOUND, { fieldId });
      }
      if (!isFieldOpen(field, booking)) {
        throw new ConflictError(R.NOT_OPEN, { fieldId });
      }
      context.field = field;
      context.limits = customerUploadLimits();
    }

    const gate = await RateLimiter.consumeAll(
      limits.customerUploadLimits({ bookingId, userId, ip }),
    );
    if (!gate.allowed) {
      throw new TooManyRequestsError(R.RATE_LIMITED, {
        retryAfterSeconds: gate.retryAfterSeconds,
      });
    }

    return context;
  }

  /**
   * The other bookings of the group an upload counts for too,
   * as the booking person chose them: `{
   * bookingId, fieldId }` each - there is no rule which fields are "the
   * same". Each is a booking of the group of the request's booking, the
   * booking person's own, with the field taking uploads there, and no
   * booking twice. A guest's link covers one booking: a guest has no
   * choice.
   *
   * @param {Object} context Of {@link admit}
   * @param {Array<{bookingId: string, fieldId: string}>|null} alsoFor
   * @returns {Promise<{targets: Array<{booking: Object, field: Object}>,
   *   groupBookingId: string|null}>} The other bookings with their field
   */
  static async targetsOf(context, alsoFor) {
    const none = { targets: [], groupBookingId: null };
    if (alsoFor === null || alsoFor === undefined) return none;
    if (!Array.isArray(alsoFor)) {
      throw new BadRequestError(R.TARGET_INVALID);
    }
    if (alsoFor.length === 0) return none;

    const { tenantId, booking, userId } = context;
    if (!userId) {
      throw new BadRequestError(R.TARGET_INVALID, { guest: true });
    }
    const group = await GroupBookingManager.getGroupBookingByBookingId(
      tenantId,
      booking.id,
      false,
      DOMAIN,
    );
    const members = new Set(group?.bookingIds || []);

    const seen = new Set([booking.id]);
    const targets = [];
    for (const target of alsoFor) {
      const bookingId = target?.bookingId;
      const fieldId = target?.fieldId;
      if (
        typeof bookingId !== "string" ||
        typeof fieldId !== "string" ||
        seen.has(bookingId) ||
        !members.has(bookingId)
      ) {
        throw new BadRequestError(R.TARGET_INVALID, { bookingId });
      }
      seen.add(bookingId);

      // The booking person's own booking alone, as for the request's one.
      const other = await BookingManager.getBooking(bookingId, tenantId, {
        reach: REACH.OWN,
        userId,
      });
      if (!other) {
        throw new BadRequestError(R.TARGET_INVALID, { bookingId });
      }
      const { settings, fields } = await CustomerUploadService._fieldsOf(other);
      const field = settings.enabled
        ? fields.find((candidate) => candidate.id === fieldId)
        : null;
      if (!field) {
        throw new NotFoundError(R.FIELD_NOT_FOUND, { bookingId, fieldId });
      }
      if (!isFieldOpen(field, other)) {
        throw new ConflictError(R.NOT_OPEN, { bookingId, fieldId });
      }
      targets.push({ booking: other, field });
    }
    return { targets, groupBookingId: group.id };
  }

  /**
   * Hands a file in for an upload field of the booking - in a group, for
   * the chosen fields of other bookings of the group too:
   * one medium with the ids of all of them and a
   * reference at each. The file counts at each booking against its field
   * and the limit of the booking.
   *
   * @param {Object} context Of {@link admit}
   * @param {Object} file The upload as express-fileupload delivers it
   * @param {Object} [options]
   * @param {string} [options.replacing] The medium the file takes the place
   *   of: it does not count against the limits
   * @param {Array<{bookingId: string, fieldId: string}>} [options.alsoFor]
   *   The other bookings of the group and their fields, see
   *   {@link targetsOf}; not with a replacement
   * @param {boolean} [options.notify] Whether the staff is told of it
   * @returns {Promise<Object>} The stored medium
   */
  static async upload(
    context,
    file,
    { replacing = null, alsoFor = null, notify = true } = {},
  ) {
    const { tenantId, booking, field, limits: instance, userId } = context;

    const { targets: others, groupBookingId } = replacing
      ? { targets: [], groupBookingId: null }
      : await CustomerUploadService.targetsOf(context, alsoFor);
    const targets = [{ booking, field }, ...others];

    // Only files still stored count, at every booking the file is for.
    const { data: accepted, detected } = await CustomerUploadService._accept(
      file,
      {
        tenantId,
        bookingId: booking.id,
        field,
        instance,
        ...countsOf(booking, field.id, { replacing }),
        alsoFor: others.map((target) => ({
          at: { bookingId: target.booking.id },
          field: target.field,
          ...countsOf(target.booking, target.field.id),
        })),
      },
    );

    const media = await MediaService.createCustomerUpload({
      tenantId,
      bookingIds: targets.map((target) => target.booking.id),
      data: accepted,
      detected,
      fileName: file.name || "upload",
      uploadedBy: userId,
    });

    const sharedWith = sharedWithOf(targets);
    const added = [];
    for (const target of targets) {
      const ok = await BookingManager.addCustomerUpload(
        tenantId,
        target.booking.id,
        referenceOf(media, target.field, userId, sharedWith),
      );
      if (!ok) {
        await CustomerUploadService._withdraw(tenantId, media, targets, added);
        throw new NotFoundError(R.BOOKING_NOT_FOUND, {
          bookingId: target.booking.id,
        });
      }
      added.push(target);
    }

    // Two uploads at once may both have passed the count above: the later
    // one gives its place back, at every booking.
    for (const target of targets) {
      const now = await BookingManager.getBooking(
        target.booking.id,
        tenantId,
        DOMAIN,
      );
      const pendingNow = (now?.customerUploads || []).filter(
        (r) =>
          isPending(r) &&
          r.fieldId === target.field.id &&
          r.mediaId !== replacing,
      );
      if (pendingNow.length > target.field.maxFiles) {
        await CustomerUploadService._withdraw(tenantId, media, targets, added);
        throw new BadRequestError(R.FIELD_FULL, {
          maxFiles: target.field.maxFiles,
          ...(target.booking.id !== booking.id
            ? { bookingId: target.booking.id }
            : {}),
        });
      }
    }

    logger.info(
      `${tenantId} -- customer upload ${media.id} for field ${field.id} of booking ${booking.id}${
        others.length
          ? ` and ${others.map((t) => `${t.field.id} of ${t.booking.id}`).join(", ")}`
          : ""
      }`,
    );
    // A replacement tells the staff once it is complete; handed in with
    // others, the request tells once for all.
    if (!replacing && notify) {
      await CustomerUploadService._tellSubmitted(context, {
        targets,
        groupBookingId,
      });
    }
    return media;
  }

  /**
   * Every proof of a booking at once, the button „Nachweise einreichen“:
   * new files for its upload fields and
   * replacements of uploads not checked yet, in the order of the request.
   * Each file runs through {@link upload} on its own, against what the
   * booking holds by then: a refused file stores nothing and leaves the
   * others standing, a refused replacement keeps the old file. Then one
   * notice „Nachweis eingereicht“ for the fields of the files stored, none
   * where every file was refused.
   *
   * A new file may name fields of other bookings of the booking person's
   * group it counts for too (`alsoFor`): one
   * medium for all of them, one notice for the group.
   *
   * @param {Object} context Of {@link admit}, `forUpload: false`
   * @param {Array<{fieldId: string, replacing: string|null, file: Object, alsoFor?: Object[]}>} entries
   * @returns {Promise<{stored: Object[], refused: Object[]}>} The stored
   *   media, and per refused file its position in `entries`, field,
   *   replaced upload, name, code and params
   */
  static async submitAll(context, entries) {
    const { tenantId, userId } = context;
    if (!entries?.length) {
      throw new BadRequestError(R.FILE_MISSING);
    }

    const { settings, fields } = await CustomerUploadService._fieldsOf(
      context.booking,
    );
    const limits = customerUploadLimits();
    let booking = context.booking;
    const stored = [];
    const refused = [];
    const replaced = new Set();

    for (const [
      index,
      { fieldId, replacing = null, file, alsoFor = null },
    ] of entries.entries()) {
      try {
        const field = settings.enabled
          ? fields.find((candidate) => candidate.id === fieldId)
          : null;
        if (!field) {
          throw new NotFoundError(R.FIELD_NOT_FOUND, { fieldId });
        }
        if (!isFieldOpen(field, booking)) {
          throw new ConflictError(R.NOT_OPEN, { fieldId });
        }
        if (replacing && replaced.has(replacing)) {
          throw new NotFoundError(R.UPLOAD_NOT_FOUND, { mediaId: replacing });
        }
        const ofFile = { tenantId, booking, field, fieldId, userId, limits };
        if (replacing) {
          CustomerUploadService._pendingReference(ofFile, replacing);
        }

        const media = await CustomerUploadService.upload(ofFile, file, {
          replacing,
          alsoFor: replacing ? null : alsoFor,
          notify: false,
        });
        if (replacing) {
          await CustomerUploadService._takeOff(tenantId, booking.id, replacing);
          replaced.add(replacing);
        }
        stored.push({ media, field });
      } catch (error) {
        if (!CustomerUploadService._isRefusal(error)) throw error;
        refused.push({
          index,
          fieldId,
          replacing,
          fileName: file?.name ?? "",
          code: error.code,
          params: { fieldId, ...error.params },
        });
      }
      // The next file counts against what the booking holds now.
      booking =
        (await BookingManager.getBooking(booking.id, tenantId, DOMAIN)) ??
        booking;
    }

    logger.info(
      `${tenantId} -- ${stored.length} customer upload(s) handed in at once for booking ${booking.id}, ${refused.length} refused`,
    );
    if (stored.length > 0) {
      const storedFields = [...new Set(stored.map((entry) => entry.field))];
      // A file for other bookings of the group too: one notice for the
      // group, naming all of them.
      const others = [
        ...new Set(stored.flatMap((entry) => entry.media.bookingIds || [])),
      ].filter((id) => id !== booking.id);
      const group = others.length
        ? await GroupBookingManager.getGroupBookingByBookingId(
            tenantId,
            booking.id,
            false,
            DOMAIN,
          )
        : null;
      await CustomerUploadService._tellSubmitted(
        { tenantId, booking, field: storedFields[0] },
        {
          targets: [
            ...storedFields.map((field) => ({ booking, field })),
            ...others.map((id) => ({
              booking: { id },
              field: storedFields[0],
            })),
          ],
          groupBookingId: group?.id ?? null,
        },
      );
    }
    return { stored: stored.map((entry) => entry.media), refused };
  }

  /** Whether an error refuses one file, not the whole request. */
  static _isRefusal(error) {
    return (
      typeof error?.code === "string" &&
      error.code.startsWith("customer_upload_") &&
      error.code !== R.RATE_LIMITED
    );
  }

  /**
   * Takes an upload back from the bookings it was handed in for: the
   * references already added, then the medium, which goes with its last
   * booking.
   */
  static async _withdraw(tenantId, media, targets, added) {
    for (const target of targets) {
      if (added.includes(target)) {
        await CustomerUploadService._takeOff(
          tenantId,
          target.booking.id,
          media.id,
        );
      } else {
        await CustomerUploadService._release(
          tenantId,
          target.booking.id,
          media.id,
        );
      }
    }
  }

  /**
   * The customer uploads of a checkout: the files
   * of the upload fields "in the checkout" of the booking being made. Every
   * file passes every check before the first one is stored; a refusal
   * stores nothing. A required field of the checkout without a file is a
   * refusal of its own. The booking is not stored yet: the caller puts the
   * references into it and stores it, and hands the references to
   * {@link releaseAll} where that fails.
   *
   * @param {Object} params
   * @param {Object} params.booking The booking as prepared, with its id
   * @param {Array<{fieldId: string, file: Object}>} params.files The files
   *   of the request, each with the field it is for
   * @param {string|null} params.uploadedBy The booking person
   * @returns {Promise<Object[]>} The references for the booking
   */
  static async acceptAtCheckout({ booking, files = [], uploadedBy = null }) {
    const checkoutFields =
      await CustomerUploadService._checkoutFieldsOfBooking(booking);

    const filesOf = new Map(checkoutFields.map((field) => [field.id, []]));
    for (const { fieldId, file } of files) {
      if (!filesOf.has(fieldId)) {
        throw new BadRequestError(R.FIELD_NOT_FOUND, { fieldId });
      }
      filesOf.get(fieldId).push(file);
    }

    const missing = checkoutFields.filter(
      (field) => field.required && filesOf.get(field.id).length === 0,
    );
    if (missing.length > 0) {
      throw new BadRequestError(R.REQUIRED_MISSING, {
        fieldIds: missing.map((field) => field.id),
        labels: missing.map((field) => field.label),
      });
    }

    // Every check first: the counts grow with each file of the request.
    const instance = customerUploadLimits();
    const accepted = [];
    let bytesInBooking = 0;
    for (const field of checkoutFields) {
      const ofField = filesOf.get(field.id);
      for (const [index, file] of ofField.entries()) {
        const result = await CustomerUploadService._accept(file, {
          tenantId: booking.tenantId,
          bookingId: booking.id,
          field,
          instance,
          inField: index,
          inBooking: accepted.length,
          bytesInBooking,
        });
        bytesInBooking += file.data.length;
        accepted.push({ field, file, ...result });
      }
    }

    // Then stored; a failure takes back what was stored before it.
    const references = [];
    try {
      for (const { field, file, data, detected } of accepted) {
        const media = await MediaService.createCustomerUpload({
          tenantId: booking.tenantId,
          bookingIds: [booking.id],
          data,
          detected,
          fileName: file.name || "upload",
          uploadedBy,
        });
        references.push(referenceOf(media, field, uploadedBy));
      }
    } catch (error) {
      await CustomerUploadService.releaseAll(
        booking.tenantId,
        booking.id,
        references,
      );
      throw error;
    }

    if (references.length > 0) {
      logger.info(
        `${booking.tenantId} -- ${references.length} customer upload(s) with the checkout of booking ${booking.id}`,
      );
    }
    return references;
  }

  /**
   * The upload fields a checkout of the bookable shows:
   * those "in the checkout", while the tenant has customer uploads enabled,
   * each with the size limit that counts - the field's, at most the
   * instance's. None of the timing, deadline or category details the
   * checkout does not need.
   *
   * @param {Object} bookable
   * @returns {Promise<Object[]>}
   */
  static async checkoutFieldsOf(bookable) {
    const definitions = (bookable?.uploadFieldDefinitions || []).filter(
      (field) => field?.timing === UPLOAD_FIELD_TIMINGS.CHECKOUT,
    );
    if (definitions.length === 0) return [];

    const tenant = await TenantManager.getTenant(bookable.tenantId, DOMAIN);
    if (!normalizeCustomerUploadSettings(tenant?.customerUploads).enabled) {
      return [];
    }
    const instance = customerUploadLimits();
    return definitions.map((field) => ({
      id: field.id,
      label: field.label,
      hint: field.hint ?? "",
      consentText: field.consentText ?? "",
      required: Boolean(field.required),
      maxFiles: field.maxFiles,
      formats: field.formats,
      maxFileSizeMb: Math.min(
        field.maxFileSizeMb ?? instance.maxFileSizeMb,
        instance.maxFileSizeMb,
      ),
    }));
  }

  /**
   * The customer uploads of a group checkout, first part:
   * every file of the request passes every check
   * before a booking or a file is stored. Each file names the bookings of
   * the group and the upload field of each it is for, `targets[key]` a
   * list of `{ attempt, fieldId }` with `attempt` the index of the booking
   * attempt as sent - there is no rule which fields are "the same". A
   * guest has no choice: each of their files is for one booking. Every
   * required upload field "in the checkout" of every booking needs a file.
   * A file counts at each of its bookings against the field and the limit
   * of the booking.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {Object[]} params.attempts The booking attempts as sent
   * @param {Array<{key: string, file: Object}>} params.files
   * @param {Object<string, Array<{attempt: number, fieldId: string}>>}
   *   params.targets By the key of each file
   * @param {boolean} params.guest Whether nobody is signed in
   * @returns {Promise<Object[]>} The accepted files, each with its bytes and
   *   its targets `{ attempt, field }`, for {@link storeAtGroupCheckout}
   */
  static async checkAtGroupCheckout({
    tenantId,
    attempts,
    files = [],
    targets = {},
    guest = false,
  }) {
    const fieldsOf = await CustomerUploadService._groupCheckoutFieldsOf(
      tenantId,
      attempts,
    );
    if (
      files.length > 0 &&
      (targets === null ||
        typeof targets !== "object" ||
        Array.isArray(targets))
    ) {
      throw new BadRequestError(R.TARGET_INVALID);
    }

    const resolved = files.map(({ key, file }) => ({
      key,
      file,
      targets: CustomerUploadService._groupTargetsOf(targets[key], {
        key,
        fieldsOf,
        guest,
      }),
    }));

    const missing = [];
    fieldsOf.forEach((fields, attempt) => {
      for (const field of fields) {
        if (!field.required) continue;
        const handedIn = resolved.some((entry) =>
          entry.targets.some(
            (target) => target.attempt === attempt && target.field === field,
          ),
        );
        if (!handedIn) missing.push({ attempt, field });
      }
    });
    if (missing.length > 0) {
      throw new BadRequestError(R.REQUIRED_MISSING, {
        fieldIds: [...new Set(missing.map(({ field }) => field.id))],
        labels: [...new Set(missing.map(({ field }) => field.label))],
        attempts: [...new Set(missing.map(({ attempt }) => attempt))],
      });
    }

    // Every check first: the counts of each booking grow with each file of
    // the request that is for it.
    const instance = customerUploadLimits();
    const counts = attempts.map(() => ({
      inBooking: 0,
      bytesInBooking: 0,
      inField: new Map(),
    }));
    const countsAt = ({ attempt, field }) => ({
      at: { attempt },
      field,
      inField: counts[attempt].inField.get(field.id) ?? 0,
      inBooking: counts[attempt].inBooking,
      bytesInBooking: counts[attempt].bytesInBooking,
    });

    const accepted = [];
    for (const { file, targets: ofFile } of resolved) {
      const [first, ...others] = ofFile;
      const result = await CustomerUploadService._accept(file, {
        tenantId,
        bookingId: null,
        instance,
        ...countsAt(first),
        alsoFor: others.map(countsAt),
      });
      for (const { attempt, field } of ofFile) {
        const count = counts[attempt];
        count.inBooking += 1;
        count.bytesInBooking += file.data.length;
        count.inField.set(field.id, (count.inField.get(field.id) ?? 0) + 1);
      }
      accepted.push({ file, targets: ofFile, ...result });
    }
    return accepted;
  }

  /**
   * The customer uploads of a group checkout, second part:
   * the members are stored; each accepted file
   * becomes one medium with the ids of its bookings and a reference at
   * each. Where a write fails, what was written of the uploads is taken
   * back and the error thrown; the caller takes the members back.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {Object[]} params.accepted Of {@link checkAtGroupCheckout}
   * @param {Object[]} params.bookings The stored members, by the index of
   *   their attempt as sent
   * @param {string|null} params.uploadedBy The booking person
   * @returns {Promise<Map<string, Object[]>>} The references by booking id
   */
  static async storeAtGroupCheckout({
    tenantId,
    accepted,
    bookings,
    uploadedBy = null,
  }) {
    const references = new Map();
    const written = [];
    try {
      for (const { file, data, detected, targets } of accepted) {
        const ofFile = targets.map(({ attempt, field }) => ({
          booking: bookings[attempt],
          field,
        }));
        const media = await MediaService.createCustomerUpload({
          tenantId,
          bookingIds: ofFile.map((target) => target.booking.id),
          data,
          detected,
          fileName: file.name || "upload",
          uploadedBy,
        });
        const added = [];
        written.push({ media, targets: ofFile, added });
        const sharedWith = sharedWithOf(ofFile);
        for (const target of ofFile) {
          const reference = referenceOf(
            media,
            target.field,
            uploadedBy,
            sharedWith,
          );
          if (
            !(await BookingManager.addCustomerUpload(
              tenantId,
              target.booking.id,
              reference,
            ))
          ) {
            throw new NotFoundError(R.BOOKING_NOT_FOUND, {
              bookingId: target.booking.id,
            });
          }
          added.push(target);
          const list = references.get(target.booking.id) ?? [];
          list.push(reference);
          references.set(target.booking.id, list);
        }
      }
    } catch (error) {
      for (const { media, targets, added } of written) {
        try {
          await CustomerUploadService._withdraw(
            tenantId,
            media,
            targets,
            added,
          );
        } catch (releaseError) {
          logger.error(
            { err: releaseError, tenantId, mediaId: media.id },
            "Customer upload of a group checkout that did not come about not released",
          );
        }
      }
      throw error;
    }

    if (written.length > 0) {
      logger.info(
        `${tenantId} -- ${written.length} customer upload(s) with the checkout of the group of ${bookings
          .map((b) => b.id)
          .join(", ")}`,
      );
    }
    return references;
  }

  /**
   * The upload fields "in the checkout" of each attempt of a group
   * checkout, by the index of the attempt: read off the current offers,
   * none while the tenant has customer uploads off.
   */
  static async _groupCheckoutFieldsOf(tenantId, attempts) {
    const idsOf = (attempt) =>
      (attempt?.bookableItems || [])
        .map((item) => item?.bookableId ?? item?.bookable?.id)
        .filter(Boolean);
    const ids = [...new Set(attempts.flatMap(idsOf))];

    const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
    if (
      ids.length === 0 ||
      !normalizeCustomerUploadSettings(tenant?.customerUploads).enabled
    ) {
      return attempts.map(() => []);
    }
    const bookables = await BookableManager.getBookablesByIds(
      tenantId,
      ids,
      DOMAIN,
    );
    const byId = new Map(bookables.map((b) => [b.id, b]));
    return attempts.map((attempt) =>
      uploadFieldsOf(
        { bookableItems: idsOf(attempt).map((bookableId) => ({ bookableId })) },
        byId,
      ).filter((field) => field.timing === UPLOAD_FIELD_TIMINGS.CHECKOUT),
    );
  }

  /** The targets of one file of a group checkout, each `{ attempt, field }`. */
  static _groupTargetsOf(list, { key, fieldsOf, guest }) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new BadRequestError(R.TARGET_INVALID, { key });
    }
    if (guest && list.length > 1) {
      throw new BadRequestError(R.TARGET_INVALID, { key, guest: true });
    }
    const seen = new Set();
    return list.map((target) => {
      const attempt = target?.attempt;
      if (
        !Number.isInteger(attempt) ||
        attempt < 0 ||
        attempt >= fieldsOf.length ||
        seen.has(attempt)
      ) {
        throw new BadRequestError(R.TARGET_INVALID, { key, attempt });
      }
      seen.add(attempt);
      const field = fieldsOf[attempt].find(
        (candidate) => candidate.id === target?.fieldId,
      );
      if (!field) {
        throw new BadRequestError(R.FIELD_NOT_FOUND, {
          fieldId: target?.fieldId,
          attempt,
        });
      }
      return { attempt, field };
    });
  }

  /**
   * Takes the media of some references back from a booking that does not
   * come about: the checkout's store failed, or its admission aborted. A
   * medium goes with its last booking. A failure is logged; the error of
   * the checkout is the one the caller sees.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {Object[]} references
   * @returns {Promise<void>}
   */
  static async releaseAll(tenantId, bookingId, references = []) {
    for (const { mediaId } of references) {
      try {
        await CustomerUploadService._release(tenantId, bookingId, mediaId);
      } catch (error) {
        logger.error(
          { err: error, tenantId, bookingId, mediaId },
          "Customer upload of a checkout that did not come about not released",
        );
      }
    }
  }

  /**
   * Replaces a customer upload not checked yet: the new file runs through
   * every step first, the old one goes only once the new one is stored.
   *
   * @param {Object} context Of {@link admit}
   * @param {string} mediaId The upload to replace
   * @param {Object} file
   * @returns {Promise<Object>} The new medium
   */
  static async replace(context, mediaId, file) {
    CustomerUploadService._pendingReference(context, mediaId);
    const media = await CustomerUploadService.upload(context, file, {
      replacing: mediaId,
    });
    await CustomerUploadService._takeOff(
      context.tenantId,
      context.booking.id,
      mediaId,
    );
    await CustomerUploadService._tellSubmitted(context);
    return media;
  }

  /**
   * Deletes a customer upload not checked yet: the customer's withdrawal of
   * the proof, the field is open again.
   *
   * @param {Object} context Of {@link admit}, `forUpload: false`
   * @param {string} mediaId
   * @returns {Promise<void>}
   */
  static async remove(context, mediaId) {
    CustomerUploadService._pendingReference(context, mediaId);
    const removed = await CustomerUploadService._takeOff(
      context.tenantId,
      context.booking.id,
      mediaId,
    );
    if (!removed) {
      // Checked in between.
      throw new ConflictError(R.ALREADY_REVIEWED, { mediaId });
    }
  }

  /**
   * The derived state of the customer uploads of some bookings, by booking
   * id - for the booking answers of the booking person and of the readers of
   * the tenant's bookings. One tenant query, one bookable query per tenant.
   *
   * @param {Object[]} bookings
   * @param {Object} [options]
   * @param {number} [options.now]
   * @param {boolean} [options.withReviewer] Whether the names of the
   *   reviewers go along - for the staff, not the customer
   * @param {boolean} [options.withGroup] Whether a booking with upload
   *   fields names its group, `group: { id, bookingIds }` - for the page
   *   „Nachweise einreichen“, which hands a file in for several bookings of
   *   the group at once
   * @returns {Promise<Map<string, Object>>}
   */
  static async statesOf(
    bookings,
    { now = Date.now(), withReviewer = false, withGroup = false } = {},
  ) {
    const states = new Map();
    if (!bookings?.length) return states;

    const tenantIds = [...new Set(bookings.map((b) => b.tenantId))];
    const tenants = await TenantManager.getTenantsByIds(tenantIds, DOMAIN);
    const settingsByTenant = new Map(
      tenants.map((t) => [
        t.id,
        normalizeCustomerUploadSettings(t.customerUploads),
      ]),
    );

    const bookablesById = new Map();
    for (const tenantId of tenantIds) {
      if (!settingsByTenant.get(tenantId)?.enabled) continue;
      const ids = [
        ...new Set(
          bookings
            .filter((b) => b.tenantId === tenantId)
            .flatMap((b) => (b.bookableItems || []).map((i) => i.bookableId))
            .filter(Boolean),
        ),
      ];
      const bookables = await BookableManager.getBookablesByIds(
        tenantId,
        ids,
        DOMAIN,
      );
      for (const bookable of bookables) {
        bookablesById.set(`${tenantId}\u0000${bookable.id}`, bookable);
      }
    }

    const holders = await CustomerUploadService._holdersOf(bookings);
    const times = await CustomerUploadService._timesOfShared(bookings);
    const instance = customerUploadLimits();
    for (const booking of bookings) {
      const ofTenant = new Map(
        (booking.bookableItems || []).map((item) => [
          item.bookableId,
          bookablesById.get(`${booking.tenantId}\u0000${item.bookableId}`),
        ]),
      );
      states.set(
        booking.id,
        deriveCustomerUploadState({
          booking,
          fields: uploadFieldsOf(booking, ofTenant),
          settings: settingsByTenant.get(booking.tenantId),
          limits: instance,
          now,
          withReviewer,
          holders,
          times,
        }),
      );
    }
    if (withGroup) {
      await CustomerUploadService._withGroups(bookings, states);
    }
    return states;
  }

  /**
   * Names the group of each booking with upload fields in its state; a
   * group found once stands for all its members.
   */
  static async _withGroups(bookings, states) {
    const groupOf = new Map();
    for (const booking of bookings) {
      const state = states.get(booking.id);
      if (!state?.fields?.length) continue;
      if (!groupOf.has(booking.id)) {
        const group = await GroupBookingManager.getGroupBookingByBookingId(
          booking.tenantId,
          booking.id,
          false,
          DOMAIN,
        );
        const named = group
          ? { id: group.id, bookingIds: [...(group.bookingIds || [])] }
          : null;
        groupOf.set(booking.id, named);
        for (const id of named?.bookingIds ?? []) groupOf.set(id, named);
      }
      state.group = groupOf.get(booking.id);
    }
  }

  /**
   * The times of the other bookings the uploads of a group count for,
   * by booking id, for the dialog of a check:
   * one query per tenant, none where no booking has such an upload.
   *
   * @param {Object[]} bookings
   * @returns {Promise<Map<string, {timeBegin: number, timeEnd: number}>>}
   */
  static async _timesOfShared(bookings) {
    const idsByTenant = new Map();
    for (const booking of bookings) {
      for (const reference of booking.customerUploads || []) {
        for (const target of reference.sharedWith || []) {
          if (target.bookingId === booking.id) continue;
          const ids = idsByTenant.get(booking.tenantId) ?? new Set();
          ids.add(target.bookingId);
          idsByTenant.set(booking.tenantId, ids);
        }
      }
    }
    const times = new Map();
    for (const [tenantId, ids] of idsByTenant) {
      const found = await BookingManager.getBookings(
        tenantId,
        [...ids],
        DOMAIN,
      );
      for (const other of found) {
        times.set(other.id, {
          timeBegin: other.timeBegin,
          timeEnd: other.timeEnd,
        });
      }
    }
    return times;
  }

  /**
   * The bookings still holding each medium of an upload of a group that
   * waits for its check, by media id: one query
   * per tenant, none where no booking has such an upload.
   *
   * @param {Object[]} bookings
   * @returns {Promise<Map<string, string[]>>}
   */
  static async _holdersOf(bookings) {
    const idsByTenant = new Map();
    for (const booking of bookings) {
      for (const reference of booking.customerUploads || []) {
        if (!isPending(reference)) continue;
        if ((reference.sharedWith || []).length < 2) continue;
        const ids = idsByTenant.get(booking.tenantId) ?? new Set();
        ids.add(reference.mediaId);
        idsByTenant.set(booking.tenantId, ids);
      }
    }
    const holders = new Map();
    for (const [tenantId, ids] of idsByTenant) {
      const media = await MediaManager.getAllMedia(
        { tenantId, id: { $in: [...ids] } },
        DOMAIN,
      );
      for (const medium of media) {
        holders.set(medium.id, [...(medium.bookingIds || [])]);
      }
    }
    return holders;
  }

  /**
   * The derived state of the booking of a request after its change, read
   * afresh.
   *
   * @param {Object} context Of {@link admit}
   * @returns {Promise<{state: string|null, fields: Object[]}>}
   */
  static async stateAfter({ tenantId, booking }) {
    const fresh =
      (await BookingManager.getBooking(booking.id, tenantId, DOMAIN)) ??
      booking;
    const states = await CustomerUploadService.statesOf([fresh]);
    return states.get(fresh.id);
  }

  /**
   * Tells the staff that a proof came in: one
   * notice „Nachweis eingereicht“ per request and booking, behind the
   * tenant's switch - one per request and group for an upload of a group
   * handed in for several of its bookings. Not at
   * the checkout - its proofs stand in the notice of the new booking. A
   * failure is logged; the upload stands.
   *
   * @param {Object} context Of {@link admit}, with the field
   * @param {Object} [shared] The bookings the upload is for, of
   *   {@link targetsOf} with the request's one first, and their group
   * @returns {Promise<void>}
   */
  static async _tellSubmitted(
    { tenantId, booking, field },
    { targets = [{ booking, field }], groupBookingId = null } = {},
  ) {
    const bookingIds = [...new Set(targets.map((target) => target.booking.id))];
    const group = bookingIds.length > 1 ? groupBookingId : null;
    try {
      await mailService.notify("CUSTOMER_UPLOAD_SUBMITTED", {
        tenantId,
        bookingId: booking.id,
        ...(group ? { groupBookingId: group, bookingIds } : {}),
        fieldLabels: [...new Set(targets.map((target) => target.field.label))],
      });
    } catch (error) {
      logger.error(
        { err: error, tenantId, bookingId: booking.id },
        "Mail about a customer upload handed in could not be sent",
      );
    }
  }

  /**
   * The upload fields "in the checkout" of a booking being made: read off
   * the offers the checkout snapshots at its items (`_bookableUsed`), the
   * tenant asked only where there are any.
   */
  static async _checkoutFieldsOfBooking(booking) {
    const snapshots = new Map(
      (booking.bookableItems || []).map((item) => [
        item.bookableId,
        item._bookableUsed,
      ]),
    );
    const fields = uploadFieldsOf(booking, snapshots).filter(
      (field) => field.timing === UPLOAD_FIELD_TIMINGS.CHECKOUT,
    );
    if (fields.length === 0) return [];

    const tenant = await TenantManager.getTenant(booking.tenantId, DOMAIN);
    return normalizeCustomerUploadSettings(tenant?.customerUploads).enabled
      ? fields
      : [];
  }

  /** The tenant's settings and the upload fields of the booked offers. */
  static async _fieldsOf(booking) {
    const tenant = await TenantManager.getTenant(booking.tenantId, DOMAIN);
    const settings = normalizeCustomerUploadSettings(tenant?.customerUploads);
    const ids = [
      ...new Set((booking.bookableItems || []).map((i) => i.bookableId)),
    ].filter(Boolean);
    const bookables = await BookableManager.getBookablesByIds(
      booking.tenantId,
      ids,
      DOMAIN,
    );
    const byId = new Map(bookables.map((b) => [b.id, b]));
    return { settings, fields: uploadFieldsOf(booking, byId) };
  }

  /**
   * The reference a replacement or deletion names: the booking's, of the
   * field of the route, not checked yet.
   */
  static _pendingReference(context, mediaId) {
    const reference = (context.booking.customerUploads || []).find(
      (r) => r.mediaId === mediaId && r.fieldId === context.fieldId,
    );
    if (!reference) {
      throw new NotFoundError(R.UPLOAD_NOT_FOUND, { mediaId });
    }
    if (!isPending(reference)) {
      throw new ConflictError(R.ALREADY_REVIEWED, { mediaId });
    }
    return reference;
  }

  /**
   * Takes a pending reference off the booking and the booking off the
   * medium; the medium goes with its last booking.
   *
   * @returns {Promise<boolean>} Whether a pending reference was taken off
   */
  static async _takeOff(tenantId, bookingId, mediaId) {
    const removed = await BookingManager.removeCustomerUpload(
      tenantId,
      bookingId,
      mediaId,
      CUSTOMER_UPLOAD_REVIEW.SUBMITTED,
    );
    if (!removed) return false;

    await CustomerUploadService._release(tenantId, bookingId, mediaId);
    return true;
  }

  /** Takes the booking off a medium; the medium goes with its last one. */
  static async _release(tenantId, bookingId, mediaId) {
    const media = await MediaManager.removeBookingReference(
      mediaId,
      tenantId,
      bookingId,
    );
    if (media && (media.bookingIds || []).length === 0) {
      await MediaService.deleteMedia(media);
    }
  }

  /**
   * The checks of one file before it is stored, in the order of the class:
   * size, number, type, clamd, an image anew. Stores nothing.
   *
   * @param {Object} file The upload as express-fileupload delivers it
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookingId
   * @param {Object} params.field The upload field
   * @param {Object} params.instance The instance limits
   * @param {number} params.inField Files of the field stored already
   * @param {number} params.inBooking Files of the booking stored already
   * @param {number} params.bytesInBooking Their bytes
   * @param {Object} [params.at] What names the booking in a refusal of a
   *   group checkout, `{ attempt }`
   * @param {Object[]} [params.alsoFor] The other bookings of a group the
   *   file counts for, each `{ at, field, inField,
   *   inBooking, bytesInBooking }` with `at` naming the booking in a
   *   refusal: size, number and format are checked at each
   * @returns {Promise<{data: Buffer, detected: Object}>} The bytes to store
   */
  static async _accept(
    file,
    {
      tenantId,
      bookingId,
      field,
      instance,
      inField,
      inBooking,
      bytesInBooking,
      at = {},
      alsoFor = [],
    },
  ) {
    if (!file?.data || file.data.length === 0) {
      throw new BadRequestError(R.FILE_MISSING, { fieldId: field.id });
    }
    const data = file.data;

    // Size of the original, against the field and the instance - at a
    // group, against every field the file is for.
    for (const target of [{ field, at }, ...alsoFor]) {
      const maxFileSizeMb = Math.min(
        target.field.maxFileSizeMb ?? instance.maxFileSizeMb,
        instance.maxFileSizeMb,
      );
      if (file.truncated || data.length > maxFileSizeMb * MEGABYTE) {
        throw new BadRequestError(R.SIZE, {
          fieldId: target.field.id,
          maxFileSizeMb,
          ...target.at,
        });
      }
    }

    // Number against the field and the limits of the booking, at every
    // booking the file is for: an upload of a group counts at each.
    CustomerUploadService._assertRoom(data, {
      at,
      field,
      instance,
      inField,
      inBooking,
      bytesInBooking,
    });
    for (const target of alsoFor) {
      CustomerUploadService._assertRoom(data, { ...target, instance });
    }

    // Type by the content against the formats of the field - of every
    // field the file is for.
    const detected = await CustomerUploadService._detect(data, field, at);
    for (const target of alsoFor) {
      await CustomerUploadService._detect(data, target.field, target.at);
    }

    // clamd; no answer is a refusal.
    await CustomerUploadService._scan(data, { tenantId, bookingId, field });

    // An image anew, without its metadata.
    return {
      data: await CustomerUploadService._reencode(data, detected),
      detected,
    };
  }

  /**
   * Room for one more file at a booking: the field's number and the
   * limits of the booking. `at` names another booking of a group in the
   * refusal.
   */
  static _assertRoom(
    data,
    { at = {}, field, instance, inField, inBooking, bytesInBooking },
  ) {
    if (inField >= field.maxFiles) {
      throw new BadRequestError(R.FIELD_FULL, {
        fieldId: field.id,
        maxFiles: field.maxFiles,
        ...at,
      });
    }
    if (
      inBooking + 1 > instance.maxFilesPerBooking ||
      bytesInBooking + data.length >
        instance.maxTotalSizeMbPerBooking * MEGABYTE
    ) {
      throw new BadRequestError(R.BOOKING_LIMIT, {
        fieldId: field.id,
        maxFiles: instance.maxFilesPerBooking,
        maxTotalSizeMb: instance.maxTotalSizeMbPerBooking,
        ...at,
      });
    }
  }

  /** The type of the bytes, if the field takes it. */
  static async _detect(data, field, at = {}) {
    const refusal = () =>
      new BadRequestError(R.FORMAT, {
        fieldId: field.id,
        formats: field.formats,
        ...at,
      });
    let detected;
    try {
      detected = await detectUploadType(data);
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw refusal();
      }
      throw error;
    }
    const format = FORMAT_OF_MIME_TYPE[detected.mimeType];
    if (!format || !field.formats.includes(format)) {
      throw refusal();
    }
    return detected;
  }

  static async _scan(data, { tenantId, bookingId, field }) {
    let result;
    try {
      result = await virusScanner().scan(data);
    } catch (error) {
      if (error instanceof ScannerUnavailableError) {
        logger.error(
          { err: error, tenantId, bookingId },
          "Virus scanner unavailable, customer upload refused",
        );
        throw new ServiceUnavailableError(R.SCANNER_UNAVAILABLE, {
          fieldId: field.id,
        });
      }
      throw error;
    }
    if (!result?.clean) {
      logger.warn(
        { tenantId, bookingId, signature: result?.signature },
        "Virus found in a customer upload, refused",
      );
      throw new BadRequestError(R.VIRUS_FOUND, { fieldId: field.id });
    }
  }

  /**
   * An image encoded anew: turned by its EXIF orientation, then written
   * without any metadata (sharp keeps none unless asked), so EXIF and GPS
   * are gone. A PDF stays as it is.
   */
  static async _reencode(data, detected) {
    if (detected.mimeType === "image/jpeg") {
      return await sharp(data, { limitInputPixels: imageMaxPixels() })
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer();
    }
    if (detected.mimeType === "image/png") {
      return await sharp(data, { limitInputPixels: imageMaxPixels() })
        .rotate()
        .png()
        .toBuffer();
    }
    return data;
  }
}

module.exports = { CustomerUploadService, CUSTOMER_UPLOAD_REASONS };
