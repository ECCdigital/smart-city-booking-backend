/**
 * The review transitions of an offer (glossary "Prüfstatus", tenant
 * supervision spec §4) as a pure function over the review object. The one
 * place the transition table is spelled; the review service applies it to
 * bookables and events alike.
 *
 *   from      | action   | to
 *   ----------|----------|---------------------------------------------
 *   null      | submit   | pending, submittedAt = now
 *   pending   | submit   | unchanged - a repeat, no new waiting time
 *   rejected  | submit   | pending, new submittedAt, decision cleared
 *   pending   | approve  | approved
 *   pending   | reject   | rejected
 *   approved  | withdraw | rejected
 *   rejected  | approve  | approved - the correction, no resubmission
 *   anything else        | ConflictError("review_transition_invalid")
 */

const { REVIEW_STATUS } = require("./supervision-constants");
const { normalizeReason } = require("./reason");
const { BadRequestError, ConflictError } = require("../../../errors/BaseError");

/** The actions a review takes (glossary "Einreichung", "Prüfentscheidung"). */
const REVIEW_ACTIONS = Object.freeze({
  SUBMIT: "submit",
  APPROVE: "approve",
  REJECT: "reject",
  WITHDRAW: "withdraw",
});

const REVIEW_ACTION_VALUES = Object.freeze(Object.values(REVIEW_ACTIONS));

/** The decisions among the actions: what the instance owner does. */
const DECISION_ACTIONS = Object.freeze([
  REVIEW_ACTIONS.APPROVE,
  REVIEW_ACTIONS.REJECT,
  REVIEW_ACTIONS.WITHDRAW,
]);

/** The review of an offer nobody has submitted yet. */
function emptyReview() {
  return {
    status: null,
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    reason: null,
  };
}

/** The transition table: `[from status][action]` → the target status. */
const TRANSITIONS = {
  null: { [REVIEW_ACTIONS.SUBMIT]: REVIEW_STATUS.PENDING },
  [REVIEW_STATUS.PENDING]: {
    [REVIEW_ACTIONS.SUBMIT]: REVIEW_STATUS.PENDING,
    [REVIEW_ACTIONS.APPROVE]: REVIEW_STATUS.APPROVED,
    [REVIEW_ACTIONS.REJECT]: REVIEW_STATUS.REJECTED,
  },
  [REVIEW_STATUS.APPROVED]: {
    [REVIEW_ACTIONS.WITHDRAW]: REVIEW_STATUS.REJECTED,
  },
  [REVIEW_STATUS.REJECTED]: {
    [REVIEW_ACTIONS.SUBMIT]: REVIEW_STATUS.PENDING,
    [REVIEW_ACTIONS.APPROVE]: REVIEW_STATUS.APPROVED,
  },
};

/**
 * Applies one action to a review.
 *
 * @param {Object|null|undefined} review The stored review of the offer;
 *   none counts as "no review status yet"
 * @param {string} action One of `REVIEW_ACTIONS`
 * @param {Object} context
 * @param {Date} context.now The server time of the action
 * @param {string|null} [context.actorUserId] Who acts; stored on decisions
 * @param {string|null} [context.reason] Optional reason; stored on decisions
 * @returns {{review: Object, changed: boolean}} The review after the
 *   action - the same values when the action is a no-op (`changed: false`)
 * @throws {BadRequestError} `invalid_review_action`, `invalid_review_reason`
 * @throws {ConflictError} `review_transition_invalid` with `{ from, action }`
 */
function applyReviewTransition(
  review,
  action,
  { now, actorUserId = null, reason } = {},
) {
  if (!REVIEW_ACTION_VALUES.includes(action)) {
    throw new BadRequestError("invalid_review_action", {
      action,
      allowed: REVIEW_ACTION_VALUES,
    });
  }
  const storedReason = normalizeReason(reason, "invalid_review_reason");
  const current = { ...emptyReview(), ...(review || {}) };
  const from = current.status ?? null;
  const to = TRANSITIONS[from]?.[action];
  if (!to) {
    throw new ConflictError("review_transition_invalid", { from, action });
  }

  if (action === REVIEW_ACTIONS.SUBMIT) {
    if (from === REVIEW_STATUS.PENDING) {
      return { review: current, changed: false };
    }
    return {
      review: { ...emptyReview(), status: to, submittedAt: now },
      changed: true,
    };
  }

  return {
    review: {
      status: to,
      submittedAt: current.submittedAt ?? null,
      decidedAt: now,
      decidedBy: actorUserId ?? null,
      reason: storedReason,
    },
    changed: true,
  };
}

module.exports = {
  REVIEW_ACTIONS,
  DECISION_ACTIONS,
  emptyReview,
  applyReviewTransition,
};
