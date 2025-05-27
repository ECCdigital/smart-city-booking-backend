/**
 * Custom error class for consistency-related errors.
 */
class ConsistencyError extends Error {
  /**
   * Create a new ConsistencyError instance.
   *
   * @param {string} code - The error code.
   * @param {string} message - The error message.
   * @param {object} [meta] - Additional metadata about the error.
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = "ConsistencyError";
    this.code = code;
    this.meta = meta;
  }
}

/**
 * Checks if the specified fields are consistent across all bookings.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @param {Array<string>} fields - The fields to compare for consistency.
 * @param {string} errorCode - The error code to throw if a mismatch is found.
 * @throws {ConsistencyError} If a mismatch is found in the specified fields.
 */
function checkSameFields(bookings, fields, errorCode) {
  const [first, ...rest] = bookings;
  const bad = rest.find((b) => fields.some((f) => first[f] !== b[f]));
  if (bad) {
    throw new ConsistencyError(
      errorCode,
      `Mismatch in fields: ${fields.join(", ")}`,
      { fields },
    );
  }
}

/**
 * Ensures all bookings have the same owner.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If the owners do not match.
 */
function checkSameOwner(bookings) {
  checkSameFields(bookings, ["assignedUserId"], "OWNER_MISMATCH");
}

/**
 * Ensures all bookings have the same contact details.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If the contact details do not match.
 */
function checkSameContactDetails(bookings) {
  checkSameFields(
    bookings,
    ["name", "street", "mail", "location", "zipCode", "phone"],
    "CONTACT_DETAILS_MISMATCH",
  );
}

/**
 * Ensures all bookings have the same status.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If the statuses do not match.
 */
function checkSameStatus(bookings) {
  checkSameFields(
    bookings,
    ["isCommitted", "isRejected", "isPayed"],
    "STATUS_MISMATCH",
  );
}

/**
 * Ensures all bookings have the same payment provider.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If the payment providers do not match.
 */
function checkSamePaymentProvider(bookings) {
  checkSameFields(bookings, ["paymentProvider"], "PAYMENT_PROVIDER_MISMATCH");
}

/**
 * Ensures all bookings are paid.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If any booking is not paid.
 */
function checkPayedStatus(bookings) {
  const bad = bookings.find((b) => !b.isPayed);
  if (bad) {
    throw new ConsistencyError("PAYED_STATUS", "All bookings must be payed", {
      bookingId: bad.id,
    });
  }
}

/**
 * Ensures all bookings have a payment provider if required.
 *
 * @param {Array<Object>} bookings - The list of bookings to check.
 * @throws {ConsistencyError} If a payment provider is required but missing.
 */
function validatePaymentProviderRequirement(bookings) {
  const bad = bookings.find(
    (b) => !b.paymentProvider && b.priceEur > 0 && !b.isPayed,
  );
  if (bad) {
    throw new ConsistencyError(
      "PAYMENT_PROVIDER_REQUIRED",
      "All bookings must have a payment provider",
      { bookingId: bad.id },
    );
  }
}

/**
 * Service for validating the consistency of bookings.
 */
class BookingConsistencyService {
  /**
   * Create a new BookingConsistencyService instance.
   *
   * @param {Function[]} checks - A list of validation functions to apply.
   */
  constructor(checks = []) {
    this.checks = checks;
  }

  /**
   * Validates the consistency of the provided bookings.
   *
   * @param {Array<Object>} bookings - The list of bookings to validate.
   * @returns {{ code: string, message: string, meta?: object }[]} A list of consistency errors.
   */
  validate(bookings) {
    const errors = [];
    for (const check of this.checks) {
      try {
        check(bookings);
      } catch (err) {
        if (err instanceof ConsistencyError) {
          errors.push({
            code: err.code,
            message: err.message,
            ...(Object.keys(err.meta).length && { meta: err.meta }),
          });
        } else {
          throw err;
        }
      }
    }
    return errors;
  }
}

module.exports = {
  ConsistencyError,
  BookingConsistencyService,
  checkSameOwner,
  checkSameStatus,
  checkSamePaymentProvider,
  checkPayedStatus,
  validatePaymentProviderRequirement,
  checkSameContactDetails,
};
