/**
 * The booking state (BookingLifecycle spec, part 1, sections 3 and 4.1).
 *
 * `booking.status` is the one stored value that says where a booking stands
 * in its life. The three flags `isCommitted`, `isPayed` and `isRejected`
 * stay in the schema, the database and the HTTP answers, but as derivations
 * of the state that only the `Booking` entity writes (`flagsFromStatus`).
 * `statusFromFlags` is the reverse reading the migration and the entity use
 * for documents and request bodies that still speak in flags.
 *
 * `nextState` is the transition table: pure, no effects. A transition out of
 * a state the table does not allow is a guard error, `ConflictError
 * invalid_transition`, raised before any effect would run.
 */

const { ConflictError } = require("../../../errors/BaseError");

const STATUS = Object.freeze({
  REQUESTED: "requested",
  PAYMENT_DUE: "payment_due",
  CONFIRMED: "confirmed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

const STATUSES = Object.freeze(Object.values(STATUS));

const TRANSITION = Object.freeze({
  ADMIT: "admit",
  CONFIRM: "confirm",
  PAY: "pay",
  CANCEL: "cancel",
  REINSTATE: "reinstate",
  AMEND: "amend",
  REQUEST_CANCEL: "requestCancel",
});

const TRANSITIONS = Object.freeze(Object.values(TRANSITION));

/** The states a booking lives in: not rejected, not cancelled. */
const LIVE_STATUSES = Object.freeze([
  STATUS.REQUESTED,
  STATUS.PAYMENT_DUE,
  STATUS.CONFIRMED,
]);

/** The states a cancellation can come from, and `reinstate` returns to. */
const CANCELLED_FROM_STATUSES = Object.freeze([
  STATUS.PAYMENT_DUE,
  STATUS.CONFIRMED,
]);

function priceOf(priceEur) {
  return Number(priceEur) || 0;
}

function isPriced(priceEur) {
  return priceOf(priceEur) > 0;
}

function invalidTransition(status, transition, booking) {
  return new ConflictError("invalid_transition", {
    bookingId: booking?.id,
    status,
    transition,
  });
}

/**
 * The transition table. Each row lists the states the transition is allowed
 * from and where it lands; `target` may inspect the booking (price, the
 * recorded origin of a cancellation, the cancellation policy) and may refuse
 * by returning `null`.
 */
const TRANSITION_TABLE = Object.freeze({
  // The checkout stores the booking in its initial state and hands it over;
  // admission changes nothing about the state.
  [TRANSITION.ADMIT]: {
    from: LIVE_STATUSES,
    target: (status) => status,
  },
  [TRANSITION.CONFIRM]: {
    from: [STATUS.REQUESTED],
    target: (status, booking) =>
      isPriced(booking.priceEur) ? STATUS.PAYMENT_DUE : STATUS.CONFIRMED,
  },
  [TRANSITION.PAY]: {
    from: [STATUS.PAYMENT_DUE],
    target: () => STATUS.CONFIRMED,
  },
  [TRANSITION.CANCEL]: {
    from: LIVE_STATUSES,
    target: (status) =>
      status === STATUS.REQUESTED ? STATUS.REJECTED : STATUS.CANCELLED,
  },
  [TRANSITION.REINSTATE]: {
    from: [STATUS.REJECTED, STATUS.CANCELLED],
    target: (status, booking) => {
      if (status === STATUS.REJECTED) {
        return STATUS.REQUESTED;
      }
      const cancelledFrom = booking.cancellationRefund?.cancelledFrom;
      return CANCELLED_FROM_STATUSES.includes(cancelledFrom)
        ? cancelledFrom
        : null;
    },
  },
  [TRANSITION.AMEND]: {
    from: STATUSES,
    target: (status) => status,
  },
  [TRANSITION.REQUEST_CANCEL]: {
    from: LIVE_STATUSES,
    target: (status, booking) =>
      booking.cancellationPolicy?.userCancellable === false ? null : status,
  },
});

/**
 * The state a booking is in after a transition, or a guard error.
 *
 * @param {string} status The state the booking is in
 * @param {string} transition One of TRANSITIONS
 * @param {{ id?: string, priceEur?: number, cancellationRefund?: { cancelledFrom?: string }, cancellationPolicy?: { userCancellable?: boolean } }} [booking]
 *   The booking, read for what the transition depends on
 * @returns {string} The state the transition lands on
 * @throws {ConflictError} `invalid_transition` with `{ bookingId, status, transition }`
 */
function nextState(status, transition, booking = {}) {
  const row = TRANSITION_TABLE[transition];
  if (!row) {
    throw new Error(`booking-state: unknown transition ${transition}`);
  }
  if (!row.from.includes(status)) {
    throw invalidTransition(status, transition, booking);
  }

  const target = row.target(status, booking);
  if (!target) {
    throw invalidTransition(status, transition, booking);
  }
  return target;
}

/**
 * The three flags a state derives to (spec part 1, 3.2). `isPayed` reads
 * as "nothing left to pay", the meaning the checkout gives it today: a
 * free booking carries it in every state and a priced one once confirmed,
 * so the readers that grant access or issue documents on it keep treating
 * free bookings as they do. Deviation from the spec's table, which reads
 * `priceEur > 0` at `confirmed` and nothing at all at `requested`;
 * recorded at ticket 2.
 *
 * @param {string} status The booking state
 * @param {number} priceEur The booking's price
 * @param {string} [cancelledFrom] The state a cancelled booking was cancelled from
 * @returns {{ isCommitted: boolean, isPayed: boolean, isRejected: boolean }}
 */
function flagsFromStatus(status, priceEur, cancelledFrom) {
  const free = !isPriced(priceEur);

  switch (status) {
    case STATUS.REQUESTED:
      return { isCommitted: false, isPayed: free, isRejected: false };
    case STATUS.PAYMENT_DUE:
      return { isCommitted: true, isPayed: false, isRejected: false };
    case STATUS.CONFIRMED:
      return { isCommitted: true, isPayed: true, isRejected: false };
    case STATUS.REJECTED:
      return { isCommitted: false, isPayed: free, isRejected: true };
    case STATUS.CANCELLED:
      return {
        isCommitted: true,
        isPayed: free || cancelledFrom === STATUS.CONFIRMED,
        isRejected: true,
      };
    default:
      throw new Error(`booking-state: unknown booking status ${status}`);
  }
}

/**
 * The state a cancelled booking was cancelled from, read off today's flags
 * (spec part 1, 3.3): confirmed where paid or free, else payment_due.
 *
 * @param {{ isPayed?: boolean }} flags
 * @param {number} priceEur The booking's price
 * @returns {string} `confirmed` or `payment_due`
 */
function cancelledFromFlags(flags, priceEur) {
  return Boolean(flags.isPayed) || !isPriced(priceEur)
    ? STATUS.CONFIRMED
    : STATUS.PAYMENT_DUE;
}

function normalizeFlags(flags = {}) {
  return {
    isCommitted: Boolean(flags.isCommitted),
    isPayed: Boolean(flags.isPayed),
    isRejected: Boolean(flags.isRejected),
  };
}

/**
 * Whether the flags say "paid, but never confirmed" of a priced booking: a
 * combination the state model does not have. A free booking carries
 * `isPayed` from the checkout on whatever its state, so there it says
 * nothing.
 *
 * @param {{ isCommitted?: boolean, isPayed?: boolean, isRejected?: boolean }} flags
 * @param {number} priceEur The booking's price
 * @returns {boolean}
 */
function isImpossibleFlagCombination(flags, priceEur) {
  const { isCommitted, isPayed, isRejected } = normalizeFlags(flags);
  return isPayed && !isCommitted && !isRejected && isPriced(priceEur);
}

/**
 * The state today's three flags stand for (spec part 1, 3.3). The impossible
 * combination "paid but never confirmed" reads as confirmed: the payment is
 * the stronger statement.
 *
 * @param {{ isCommitted?: boolean, isPayed?: boolean, isRejected?: boolean }} flags
 * @param {number} priceEur The booking's price
 * @returns {string} One of STATUSES
 */
function statusFromFlags(flags, priceEur) {
  const { isCommitted, isPayed, isRejected } = normalizeFlags(flags);

  if (isRejected) {
    return isCommitted ? STATUS.CANCELLED : STATUS.REJECTED;
  }
  if (isImpossibleFlagCombination(flags, priceEur)) {
    return STATUS.CONFIRMED;
  }
  if (!isCommitted) {
    return STATUS.REQUESTED;
  }
  if (isPriced(priceEur) && !isPayed) {
    return STATUS.PAYMENT_DUE;
  }
  return STATUS.CONFIRMED;
}

module.exports = {
  STATUS,
  STATUSES,
  LIVE_STATUSES,
  CANCELLED_FROM_STATUSES,
  TRANSITION,
  TRANSITIONS,
  TRANSITION_TABLE,
  nextState,
  flagsFromStatus,
  cancelledFromFlags,
  statusFromFlags,
  isImpossibleFlagCombination,
};
