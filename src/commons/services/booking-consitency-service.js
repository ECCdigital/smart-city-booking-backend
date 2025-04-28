class ConsistencyError extends Error {
  /**
   * @param {string} code —
   * @param {string} message —
   * @param {object} [meta] —
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = "ConsistencyError";
    this.code = code;
    this.meta = meta;
  }
}

function checkSameFields(bookings, fields, errorCode) {
  const [first, ...rest] = bookings;
  const bad = rest.find(b =>
    fields.some(f => first[f] !== b[f])
  );
  if (bad) {
    throw new ConsistencyError(
      errorCode,
      `Mismatch in fields: ${fields.join(", ")}`,
      { fields }
    );
  }
}

function checkSameOwner(bookings) {
  checkSameFields(
    bookings,
    ["name", "street", "mail", "location", "zipCode", "phone"],
    "OWNER_MISMATCH"
  );
}

function checkSameStatus(bookings) {
  checkSameFields(
    bookings,
    ["isCommitted", "isRejected", "isPayed"],
    "STATUS_MISMATCH"
  );
}

function checkSamePaymentProvider(bookings) {
  checkSameFields(
    bookings,
    ["paymentProvider"],
    "PAYMENT_PROVIDER_MISMATCH"
  );
}

function checkPayedStatus(bookings) {
  const bad = bookings.find(b => !b.isPayed);
  if (bad) {
    throw new ConsistencyError(
      "PAYED_STATUS",
      "All bookings must be payed",
      { bookingId: bad.id }
    );
  }
}


class BookingConsistencyService {
  /**
   * @param {Function[]} checks —
   */
  constructor(checks = []) {
    this.checks = checks;
  }

  /**
   * @param {Array<Object>} bookings
   * @returns {{ code: string, message: string, meta?: object }[]}
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
            ...Object.keys(err.meta).length && { meta: err.meta }
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
};
