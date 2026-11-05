const { v4: uuidv4 } = require("uuid");
const { BadRequestError } = require("../../../errors/BaseError");
const { positiveNumber } = require("../media/media-config");

/**
 * Rules of customer uploads (glossary "Kunden-Upload", in the UI
 * "Nachweis"): the tenant's settings, the upload fields of a bookable and the
 * instance limits.
 */

/** The formats a customer upload may ever have. */
const CUSTOMER_UPLOAD_FORMATS = Object.freeze(["pdf", "jpeg", "png"]);

const UPLOAD_FIELD_CATEGORIES = Object.freeze({
  NORMAL: "normal",
  // Deleted right after its check, even while other checks are open.
  SENSITIVE: "sensitive",
});

const UPLOAD_FIELD_TIMINGS = Object.freeze({
  CHECKOUT: "checkout",
  AFTER_CONFIRMATION: "afterConfirmation",
});

/** Biletado keeps a customer upload at most this long after the booking. */
const MAX_RETENTION_DAYS = 30;
// Days before the upload deadline the booker is reminded of a missing
// required upload.
const DEFAULT_REMINDER_DAYS = 3;
// Days before the automatic deletion the staff is reminded of an upload
// nobody has checked yet.
const DEFAULT_REVIEW_REMINDER_DAYS = 3;
const MIN_FILES_PER_FIELD = 1;
const MAX_FILES_PER_FIELD = 5;

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_MAX_FILES_PER_BOOKING = 20;
const DEFAULT_MAX_TOTAL_SIZE_MB_PER_BOOKING = 100;

/**
 * The tenant's settings when it has none stored yet.
 *
 * @returns {Object}
 */
function defaultCustomerUploadSettings() {
  return {
    enabled: false,
    formats: [...CUSTOMER_UPLOAD_FORMATS],
    retentionDays: MAX_RETENTION_DAYS,
    reminderDaysBeforeDeadline: DEFAULT_REMINDER_DAYS,
    reviewReminderDaysBeforeDeletion: DEFAULT_REVIEW_REMINDER_DAYS,
    notifyOnSubmitted: true,
    notifyOnOverdue: true,
  };
}

/**
 * The limits of the instance, set by environment variables and apart from
 * the limits of the media library.
 *
 * @returns {{maxFileSizeMb: number, maxFilesPerBooking: number, maxTotalSizeMbPerBooking: number}}
 */
function customerUploadLimits() {
  return {
    maxFileSizeMb: positiveNumber(
      "CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB",
      DEFAULT_MAX_FILE_SIZE_MB,
    ),
    maxFilesPerBooking: positiveNumber(
      "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
      DEFAULT_MAX_FILES_PER_BOOKING,
    ),
    maxTotalSizeMbPerBooking: positiveNumber(
      "CUSTOMER_UPLOAD_MAX_TOTAL_SIZE_MB_PER_BOOKING",
      DEFAULT_MAX_TOTAL_SIZE_MB_PER_BOOKING,
    ),
  };
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isIntegerIn = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

function formatsError(formats, allowed, code, params = {}) {
  if (!Array.isArray(formats)) {
    return new BadRequestError("customer_upload_formats_invalid", params);
  }
  const outside = formats.filter((format) => !allowed.includes(format));
  if (outside.length > 0) {
    return new BadRequestError(code, { ...params, formats: outside });
  }
  return null;
}

/**
 * The tenant's settings as stored: what the request brings over the
 * defaults, so a tenant from before the feature gets complete settings.
 *
 * @param {Object} settings
 * @returns {Object}
 */
function normalizeCustomerUploadSettings(settings) {
  const normalized = {
    ...defaultCustomerUploadSettings(),
    ...(isPlainObject(settings) ? settings : {}),
  };
  if (Array.isArray(normalized.formats)) {
    normalized.formats = [...new Set(normalized.formats)];
  }
  return normalized;
}

/**
 * Why the tenant's settings cannot be stored, or null.
 *
 * @param {Object} settings Normalized settings.
 * @returns {BadRequestError|null}
 */
function getCustomerUploadSettingsError(settings) {
  if (!isPlainObject(settings)) {
    return new BadRequestError("customer_upload_settings_invalid");
  }
  for (const flag of ["enabled", "notifyOnSubmitted", "notifyOnOverdue"]) {
    if (typeof settings[flag] !== "boolean") {
      return new BadRequestError("customer_upload_settings_invalid", {
        field: flag,
      });
    }
  }

  const formatError = formatsError(
    settings.formats,
    CUSTOMER_UPLOAD_FORMATS,
    "customer_upload_format_not_supported",
  );
  if (formatError) return formatError;
  if (settings.enabled && settings.formats.length === 0) {
    return new BadRequestError("customer_upload_formats_empty");
  }

  if (!isIntegerIn(settings.retentionDays, 0, MAX_RETENTION_DAYS)) {
    return new BadRequestError("customer_upload_retention_out_of_range", {
      max: MAX_RETENTION_DAYS,
    });
  }
  if (!isIntegerIn(settings.reminderDaysBeforeDeadline, 0, 365)) {
    return new BadRequestError("customer_upload_reminder_out_of_range");
  }
  if (
    !isIntegerIn(
      settings.reviewReminderDaysBeforeDeletion,
      0,
      MAX_RETENTION_DAYS,
    )
  ) {
    return new BadRequestError("customer_upload_review_reminder_out_of_range", {
      max: MAX_RETENTION_DAYS,
    });
  }
  return null;
}

/**
 * The upload fields of a bookable as stored: a stable id for each field,
 * defaults for what is left out, no deadline on a field of the checkout.
 * The id never changes, so renaming or deleting a field later keeps the
 * notes on bookings readable.
 *
 * @param {Array} definitions
 * @returns {Array} The same array, its entries normalized in place.
 */
function normalizeUploadFieldDefinitions(definitions) {
  if (!Array.isArray(definitions)) return definitions;

  definitions.forEach((definition) => {
    if (!isPlainObject(definition)) return;
    if (typeof definition.id !== "string" || definition.id.trim() === "") {
      definition.id = uuidv4();
    }
    definition.hint ??= "";
    definition.consentText ??= "";
    definition.required ??= false;
    definition.maxFiles ??= MIN_FILES_PER_FIELD;
    definition.maxFileSizeMb ??= null;
    definition.category ??= UPLOAD_FIELD_CATEGORIES.NORMAL;
    definition.timing ??= UPLOAD_FIELD_TIMINGS.CHECKOUT;
    if (definition.timing === UPLOAD_FIELD_TIMINGS.CHECKOUT) {
      definition.deadlineDaysBeforeStart = null;
    } else {
      definition.deadlineDaysBeforeStart ??= null;
    }
  });
  return definitions;
}

/**
 * Why the upload fields of a bookable cannot be stored, or null.
 *
 * @param {Array} definitions Normalized upload fields.
 * @param {Object} settings The tenant's normalized settings.
 * @param {Object} [limits] The instance limits.
 * @returns {BadRequestError|null}
 */
function getUploadFieldDefinitionsError(
  definitions,
  settings,
  limits = customerUploadLimits(),
) {
  if (!Array.isArray(definitions)) {
    return new BadRequestError("upload_field_invalid");
  }

  const seenIds = new Set();
  for (const definition of definitions) {
    if (!isPlainObject(definition)) {
      return new BadRequestError("upload_field_invalid");
    }
    const params = { fieldId: definition.id };

    if (seenIds.has(definition.id)) {
      return new BadRequestError("upload_field_duplicate_id", params);
    }
    seenIds.add(definition.id);

    if (typeof definition.label !== "string" || !definition.label.trim()) {
      return new BadRequestError("upload_field_label_required", params);
    }
    for (const text of ["hint", "consentText"]) {
      if (typeof definition[text] !== "string") {
        return new BadRequestError("upload_field_invalid", {
          ...params,
          field: text,
        });
      }
    }
    if (typeof definition.required !== "boolean") {
      return new BadRequestError("upload_field_invalid", {
        ...params,
        field: "required",
      });
    }

    if (
      !isIntegerIn(
        definition.maxFiles,
        MIN_FILES_PER_FIELD,
        MAX_FILES_PER_FIELD,
      )
    ) {
      return new BadRequestError("upload_field_max_files_out_of_range", {
        ...params,
        min: MIN_FILES_PER_FIELD,
        max: MAX_FILES_PER_FIELD,
      });
    }

    const formatError = formatsError(
      definition.formats,
      settings.formats,
      "upload_field_format_not_allowed",
      params,
    );
    if (formatError) return formatError;
    if (definition.formats.length === 0) {
      return new BadRequestError("upload_field_formats_empty", params);
    }

    const size = definition.maxFileSizeMb;
    if (size !== null) {
      if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
        return new BadRequestError("upload_field_max_size_invalid", params);
      }
      if (size > limits.maxFileSizeMb) {
        return new BadRequestError("upload_field_max_size_above_instance", {
          ...params,
          max: limits.maxFileSizeMb,
        });
      }
    }

    if (!Object.values(UPLOAD_FIELD_CATEGORIES).includes(definition.category)) {
      return new BadRequestError("upload_field_category_invalid", params);
    }
    if (!Object.values(UPLOAD_FIELD_TIMINGS).includes(definition.timing)) {
      return new BadRequestError("upload_field_timing_invalid", params);
    }

    const deadline = definition.deadlineDaysBeforeStart;
    if (deadline !== null && !isIntegerIn(deadline, 0, 365)) {
      return new BadRequestError("upload_field_deadline_invalid", params);
    }
  }
  return null;
}

module.exports = {
  CUSTOMER_UPLOAD_FORMATS,
  UPLOAD_FIELD_CATEGORIES,
  UPLOAD_FIELD_TIMINGS,
  MAX_RETENTION_DAYS,
  MAX_FILES_PER_FIELD,
  customerUploadLimits,
  defaultCustomerUploadSettings,
  getCustomerUploadSettingsError,
  getUploadFieldDefinitionsError,
  normalizeCustomerUploadSettings,
  normalizeUploadFieldDefinitions,
};
