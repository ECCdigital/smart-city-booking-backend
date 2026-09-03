/**
 * The admin PUT as a plan (BookingLifecycle spec, part 1, section 6).
 *
 * The PUT keeps carrying the three flags. `planUpdate` reads them against
 * the state the booking is in and answers the lifecycle transitions the
 * update needs: `amend` first, the content change, then the state changes
 * the flags ask for, each one atomic for itself. Flags no sequence of
 * transitions reaches are a `BadRequestError invalid_status_change`.
 *
 * Pure. `BookingService.updateBooking` runs the plan.
 */

const { BadRequestError, ConflictError } = require("../../../errors/BaseError");
const {
  STATUS,
  TRANSITION,
  nextState,
  normalizeFlags,
  flagsFromStatus,
  isImpossibleFlagCombination,
} = require("./booking-state");

/**
 * The transition sequences an update may run from each state, shortest
 * first. `reinstate` stands alone: an un-cancel lands exactly on the state
 * the booking was cancelled from, anything further is refused.
 */
const CANDIDATE_PATHS = Object.freeze({
  [STATUS.REQUESTED]: [
    [TRANSITION.CONFIRM],
    [TRANSITION.CANCEL],
    [TRANSITION.CONFIRM, TRANSITION.PAY],
    [TRANSITION.CONFIRM, TRANSITION.CANCEL],
    [TRANSITION.CONFIRM, TRANSITION.PAY, TRANSITION.CANCEL],
  ],
  [STATUS.PAYMENT_DUE]: [
    [TRANSITION.PAY],
    [TRANSITION.CANCEL],
    [TRANSITION.PAY, TRANSITION.CANCEL],
  ],
  [STATUS.CONFIRMED]: [[TRANSITION.CANCEL]],
  [STATUS.REJECTED]: [[TRANSITION.REINSTATE]],
  [STATUS.CANCELLED]: [[TRANSITION.REINSTATE]],
});

/**
 * Whether two flag sets ask for the same state. A free booking carries
 * `isPayed` from the checkout on whatever its state, so there the flag is
 * not compared.
 */
function sameFlags(left, right, priceEur) {
  const priced = (Number(priceEur) || 0) > 0;
  return (
    left.isCommitted === right.isCommitted &&
    left.isRejected === right.isRejected &&
    (!priced || left.isPayed === right.isPayed)
  );
}

/**
 * Runs a candidate path through the transition table and answers the flags
 * it ends on, or `null` where the table refuses a step.
 */
function flagsAfter(path, currentStatus, priceEur, cancelledFrom) {
  let status = currentStatus;
  let from = cancelledFrom;

  for (const transition of path) {
    const booking = { priceEur, cancellationRefund: { cancelledFrom: from } };
    let next;
    try {
      next = nextState(status, transition, booking);
    } catch (error) {
      if (error instanceof ConflictError) {
        return null;
      }
      throw error;
    }
    if (transition === TRANSITION.CANCEL) {
      from = status;
    }
    status = next;
  }

  return flagsFromStatus(status, priceEur, from);
}

/**
 * The transitions an admin update needs to reach the requested flags.
 *
 * @param {string} currentStatus The state the booking is in
 * @param {{ isCommitted?: boolean, isPayed?: boolean, isRejected?: boolean }} requestedFlags
 *   The flags the PUT carries
 * @param {number} priceEur The price the booking has after the update
 * @param {{ cancelledFrom?: string }} [context] The state a cancelled booking
 *   was cancelled from (`cancellationRefund.cancelledFrom`)
 * @returns {string[]} The transitions in order, `amend` always first
 * @throws {BadRequestError} `invalid_status_change` with `{ status, requested }`
 */
function planUpdate(
  currentStatus,
  requestedFlags,
  priceEur,
  { cancelledFrom } = {},
) {
  const requested = normalizeFlags(requestedFlags);
  const current = flagsFromStatus(currentStatus, priceEur, cancelledFrom);

  if (sameFlags(requested, current, priceEur)) {
    return [TRANSITION.AMEND];
  }

  if (!isImpossibleFlagCombination(requested, priceEur)) {
    for (const path of CANDIDATE_PATHS[currentStatus]) {
      const reached = flagsAfter(path, currentStatus, priceEur, cancelledFrom);
      if (reached && sameFlags(requested, reached, priceEur)) {
        return [TRANSITION.AMEND, ...path];
      }
    }
  }

  throw new BadRequestError("invalid_status_change", {
    status: currentStatus,
    requested,
  });
}

module.exports = { planUpdate, CANDIDATE_PATHS };
