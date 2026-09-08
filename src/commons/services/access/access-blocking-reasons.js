/**
 * Why an access attempt was refused. One vocabulary for everyone: the open
 * endpoint answers with it, the scan landing page renders it and the access
 * audit stores it, so a refusal reads the same wherever it surfaces.
 */
const ACCESS_BLOCKING_REASONS = Object.freeze({
  REJECTED: "rejected",
  NOT_COMMITTED: "not_committed",
  PAYMENT_REQUIRED: "payment_required",
  AUTHORIZATION_REVOKED: "authorization_revoked",
  OUTSIDE_ACCESS_WINDOW: "outside_access_window",
  NOT_PROVISIONED: "not_provisioned",
  NO_REMOTE_ACCESS: "no_remote_access",
  EVIDENCE_MISSING: "evidence_missing",
  EVIDENCE_INVALID: "evidence_invalid",
  EVIDENCE_RULE_UNAVAILABLE: "evidence_rule_unavailable",
});

/**
 * Most relevant reason first. The booking conditions come before the evidence
 * reasons because they are checked first: someone whose booking is not paid is
 * told to pay, not to walk to the door and scan.
 *
 * Within the evidence reasons a rule that cannot be evaluated at all outranks
 * the ones the person at the door can act on - it is a configuration problem
 * only the administration can fix.
 */
const ACCESS_BLOCKING_REASON_PRIORITY = Object.freeze([
  ACCESS_BLOCKING_REASONS.REJECTED,
  ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
  ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED,
  ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED,
  ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
  ACCESS_BLOCKING_REASONS.NOT_PROVISIONED,
  ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
  ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
  ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
  ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
]);

/**
 * Sort blocking reasons by priority and drop duplicates.
 *
 * @param {string[]} reasons Blocking reasons in any order
 * @returns {string[]} The distinct reasons, most relevant first
 */
function prioritizeBlockingReasons(reasons = []) {
  const unique = [...new Set(reasons)];
  return unique.sort(
    (a, b) =>
      ACCESS_BLOCKING_REASON_PRIORITY.indexOf(a) -
      ACCESS_BLOCKING_REASON_PRIORITY.indexOf(b),
  );
}

module.exports = {
  ACCESS_BLOCKING_REASONS,
  prioritizeBlockingReasons,
};
