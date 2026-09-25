const {
  ACCESS_BLOCKING_REASONS,
  prioritizeBlockingReasons,
} = require("./access-blocking-reasons");
const { getValidationRule } = require("./access-validation-rules");
const AccessEvidenceService = require("./access-evidence-service");
const { AccessPointMode } = require("../../entities/access/access-point");
const { AccessPointType } = require("../../schemas/accessPointSchema");

/**
 * The access decision: the one answer to "may this person operate the access
 * points of this booking right now?".
 *
 * It is computed from the booking, its access points and the point in time,
 * never from the channel a request came through. Both functions are pure and
 * synchronous - data in, decision out - and know neither the database nor the
 * providers. They load no rights either: whether the person may manage the
 * bookings of the tenant is a fact the caller has established and hands in,
 * and whether the booking is theirs is read off the loaded booking at its
 * owner key (`assignedUserId`, spec §4.1).
 *
 * @typedef {Object} AccessPointEntry An access point of a booking, as the
 *   resolver pairs it with the booking context it was resolved with
 * @property {Object} accessPoint The access point - `id`, `type`, `mode` and
 *   its rules (`validationRules`: the configured rules, `[]` for none, `null`
 *   where nobody can see them)
 * @property {Object} bookingContext What the booking adds to it -
 *   `accessBuffer`, `accessFrom`, `accessTo` (the door's buffered window in
 *   epoch ms; where absent it is the booking period widened by the buffer),
 *   `isProvisioned`, `revokedAt`, `grant`. A compartment of a locker system
 *   is one entry of its own, under the compartment's id
 *
 * {@link decide} answers the booking layer: the role the person acts in, which
 * access points they may operate, the prioritized reasons against it, and what
 * evidence each access point demands of them. {@link satisfy} is the second
 * step of the same decision: whether the evidence a client sent meets what one
 * access point demands.
 *
 * @typedef {Object} Decision
 * @property {"booker"|"manager"|null} accessRole The capacity the person acts
 *   in at the booking: `booker` where the booking is theirs, `manager` where
 *   they may manage one that is not, `null` where they have no standing
 * @property {boolean} canView Whether the booking's access points may be listed
 * @property {boolean} canOperate Whether any access point may be operated now
 * @property {boolean} canOperateRemote Whether any of those may be opened
 *   through the API
 * @property {boolean} canUseAuthorization Whether a granted, unrevoked
 *   authorization (keypad code, key card) is usable at any door
 * @property {string[]} blockingReasons Prioritized reasons against operating,
 *   from {@link ACCESS_BLOCKING_REASONS}. Some are hints rather than locks:
 *   a door that can be opened remotely stays operable while its grant is
 *   missing or revoked; one that only takes a code does not
 * @property {string|null} primaryBlockingReason The first of them
 * @property {string[]} operableAccessPointIds Access points that may be
 *   operated now: close, status, open-status
 * @property {string[]} remoteOperableAccessPointIds The operable ones whose
 *   mode allows an open through the API - the set open checks against
 * @property {string[]} overriddenAccessPointIds The operable ones that are
 *   operable only through the admin override: past their window and commanded
 *   by the manage permission. Never among the remote operable ones - a lock
 *   left open is closed and read, not opened again
 * @property {boolean} evidenceWaived Whether the evidence rules do not apply
 *   to this person - only to the management at somebody else's booking
 * @property {Object<string, string[]>} demandedEvidence The rule types each
 *   access point demands of this person, by access point id
 * @property {{ from: number, to: number }|null} accessWindow The booking's
 *   access window envelope in epoch ms: the earliest `accessFrom` and the
 *   latest `accessTo` over its access points, so a client can tell an
 *   upcoming booking from an active or a past one at the same bounds this
 *   decision gates on. `null` where the booking has no access points - the
 *   per-door windows stay the truth of each row
 */

/**
 * Decide what a person may do with the access points of a booking.
 *
 * @param {import("../../entities/booking/booking").Booking} booking The loaded
 *   booking
 * @param {AccessPointEntry[]} accessPoints The access points of the booking
 * @param {Object} [options]
 * @param {string|null} [options.userId=null] The acting person
 * @param {boolean} [options.canManage=false] Whether that person may manage
 *   the bookings of the tenant. Replaces ownership, and after a door's window
 *   grants the admin override at it; it never bypasses the booking conditions
 * @param {number} [options.now=Date.now()] The point in time, in ms
 * @returns {Decision} The decision
 */
function decide(
  booking,
  accessPoints = [],
  { userId = null, canManage = false, now = Date.now() } = {},
) {
  const accessRole = resolveAccessRole(booking, userId, canManage);
  const hasRole = accessRole !== null;
  const isValid = booking.isBookingValid();
  const evidenceWaived = accessRole === "manager";

  const blockingReasons = [];
  if (booking.isRejected) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.REJECTED);
  }
  if (!booking.isCommitted) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.NOT_COMMITTED);
  }
  if (booking.priceEur > 0 && !booking.isPayed) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED);
  }

  const operableAccessPointIds = [];
  const remoteOperableAccessPointIds = [];
  const overriddenAccessPointIds = [];
  const demandedEvidence = {};

  let anyInWindow = false;
  let anyRevoked = false;
  let anyUnprovisioned = false;
  let anyAuthorizationUsable = false;
  let anyRemoteCapable = false;
  let accessWindow = null;

  for (const { accessPoint, bookingContext } of accessPoints) {
    const id = String(accessPoint.id);
    const { accessFrom, accessTo } = windowOf(booking, bookingContext);
    const inWindow = accessFrom <= now && accessTo >= now;

    // The envelope: the earliest start and the latest end over all doors.
    accessWindow = {
      from: Math.min(accessWindow?.from ?? accessFrom, accessFrom),
      to: Math.max(accessWindow?.to ?? accessTo, accessTo),
    };

    demandedEvidence[id] = evidenceWaived
      ? []
      : demandedEvidenceOf(accessPoint);

    if (inWindow) {
      anyInWindow = true;
    }
    if (supportsRemote(accessPoint.mode)) {
      anyRemoteCapable = true;
    }

    const revokedAt = bookingContext.revokedAt ?? null;
    if (revokedAt) {
      anyRevoked = true;
    }

    // An access point whose grant is its only way in is nothing without the
    // grant: no grant or a revoked one locks it. That is a door that only
    // takes a code - and every compartment of a locker system, which is
    // assigned by the grant whatever mode the system opens in. A door that
    // also opens remotely stays operable meanwhile, and the missing or
    // revoked grant is a hint at it.
    let authorizationUsable = false;
    const grantIsTheOnlyWayIn =
      accessPoint.mode === AccessPointMode.AUTHORIZATION ||
      accessPoint.type === AccessPointType.LOCKER;
    if (grantIsTheOnlyWayIn || usesAuthorization(accessPoint.mode)) {
      const isGranted =
        bookingContext.isProvisioned === true &&
        Boolean(bookingContext.grant?.authorizationId);
      if (!isGranted) {
        anyUnprovisioned = true;
      } else if (!revokedAt) {
        authorizationUsable = true;
        anyAuthorizationUsable = true;
      }
    }
    const lockedForWantOfGrant = grantIsTheOnlyWayIn && !authorizationUsable;

    // The admin override: whoever may manage the bookings may close and read
    // a door after its window has ended, so a lock left open can be brought
    // back to a known state. It hangs on the permission, not on the role -
    // the booker with the permission has it at their own booking too. Never
    // before the window: a lock standing open before a booking starts is not
    // this booking's business. It lifts nothing but the window.
    const overridden = canManage && now > accessTo;

    if (
      !isValid ||
      !(inWindow || overridden) ||
      !hasRole ||
      lockedForWantOfGrant
    ) {
      continue;
    }

    operableAccessPointIds.push(id);
    if (inWindow && supportsRemote(accessPoint.mode)) {
      remoteOperableAccessPointIds.push(id);
    }
    if (!inWindow) {
      overriddenAccessPointIds.push(id);
    }
  }

  const canView = isValid && hasRole;

  if (hasRole && accessPoints.length > 0 && !anyInWindow) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW);
  }
  if (anyRevoked) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED);
  }
  if (anyUnprovisioned) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.NOT_PROVISIONED);
  }
  if (canView && anyInWindow && !anyRemoteCapable && accessPoints.length > 0) {
    blockingReasons.push(ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS);
  }

  const prioritized = prioritizeBlockingReasons(blockingReasons);

  return {
    accessRole,
    canView,
    canOperate: operableAccessPointIds.length > 0,
    canOperateRemote: remoteOperableAccessPointIds.length > 0,
    canUseAuthorization: anyAuthorizationUsable,
    blockingReasons: prioritized,
    primaryBlockingReason: prioritized[0] ?? null,
    operableAccessPointIds,
    remoteOperableAccessPointIds,
    overriddenAccessPointIds,
    evidenceWaived,
    demandedEvidence,
    accessWindow,
  };
}

/**
 * The buffered window of one door, in epoch ms. The resolver states it on the
 * booking context (`accessFrom` / `accessTo`, the same values the access-point
 * projection hands out); a context that carries only the buffer gets the
 * booking period widened by it, which is the same arithmetic.
 */
function windowOf(booking, bookingContext) {
  const beforeMs = bookingContext.accessBuffer?.beforeMs ?? 0;
  const afterMs = bookingContext.accessBuffer?.afterMs ?? 0;

  return {
    accessFrom: bookingContext.accessFrom ?? booking.timeBegin - beforeMs,
    accessTo: bookingContext.accessTo ?? booking.timeEnd + afterMs,
  };
}

/**
 * The second step of the decision: does the evidence a client sent meet what
 * this access point demands of this person?
 *
 * All configured rules have to be fulfilled; there are no alternatives. Each
 * rule picks its evidence by type, at most one per type, and anything else the
 * client sent is ignored rather than rejected - a client may know more evidence
 * types than this door asks for. A rule this server cannot evaluate blocks the
 * door rather than being skipped, and so do rules nobody can see
 * (`validationRules: null`, as opposed to `[]` for a door without rules) - the
 * whole point of a rule is that it is not silently optional.
 *
 * A compartment of a locker system is held to the rules of that system like a
 * door to its own - a locker system without rules (`[]`) asks for nothing,
 * and that is a property of its rules, not of its type. The management is
 * waived the rules of a door (`decision.evidenceWaived`), which is recorded
 * as a bypass only where there were rules to bypass.
 *
 * @param {Decision} decision The decision for the booking, as of {@link decide}
 * @param {Object} accessPoint The access point being opened, with its rules
 *   (`validationRules`) and the fields they are checked against
 * @param {Object[]} [evidence=[]] Evidence objects as sent by the client
 * @returns {{ satisfied: boolean, bypassed: boolean, blockingReasons: string[],
 *   validatedEvidence: string[] }} Whether the door may open, whether rules
 *   were skipped, the prioritized reasons if not, and the rules that were
 *   actually proven
 */
function satisfy(decision, accessPoint, evidence = []) {
  if (accessPoint.validationRules === null) {
    return evidenceOutcome({
      satisfied: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE],
    });
  }

  const validationRules = accessPoint.validationRules || [];

  if (validationRules.length === 0) {
    return evidenceOutcome({ satisfied: true });
  }

  if (decision.evidenceWaived) {
    return evidenceOutcome({ satisfied: true, bypassed: true });
  }

  const evidenceByType = indexEvidenceByType(evidence);
  const blockingReasons = [];
  const validatedEvidence = [];

  for (const configuredRule of validationRules) {
    const reason = evaluateRule(configuredRule, accessPoint, evidenceByType);

    if (reason) {
      blockingReasons.push(reason);
    } else {
      validatedEvidence.push(configuredRule.type);
    }
  }

  const prioritized = prioritizeBlockingReasons(blockingReasons);

  return evidenceOutcome({
    satisfied: prioritized.length === 0,
    blockingReasons: prioritized,
    validatedEvidence: prioritized.length === 0 ? validatedEvidence : [],
  });
}

/**
 * What an access point demands of anyone it is not waived for: the types of
 * its rules, without their configuration. Where the rules are unknown there
 * is nothing to name either; {@link satisfy} is what keeps that door shut.
 *
 * @param {Object} accessPoint The access point, with its `validationRules`
 * @returns {string[]} The distinct rule types
 */
function demandedEvidenceOf(accessPoint) {
  const types = Array.isArray(accessPoint.validationRules)
    ? accessPoint.validationRules.map((rule) => rule?.type)
    : [];

  return [...new Set(types.filter((type) => typeof type === "string"))];
}

/**
 * The role someone acts in at a booking: `booker` when the booking is theirs
 * (owned or assigned), `manager` when they may manage someone else's booking,
 * `null` when they may do neither. Ownership beats the manage permission -
 * whoever holds both is the booker at their own booking.
 */
function resolveAccessRole(booking, userId, canManage) {
  if (isBooker(booking, userId)) {
    return "booker";
  }

  return canManage ? "manager" : null;
}

/**
 * Whether a booking is the user's: the user it is assigned to. A fact of
 * the booking, no reach - the access decision never holds one.
 *
 * @param {Object} booking
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
function isBooker(booking, userId) {
  return Boolean(userId) && booking?.assignedUserId === userId;
}

function usesAuthorization(mode) {
  return (
    mode === AccessPointMode.AUTHORIZATION || mode === AccessPointMode.BOTH
  );
}

function supportsRemote(mode) {
  return mode === AccessPointMode.REMOTE || mode === AccessPointMode.BOTH;
}

function evidenceOutcome({
  satisfied,
  bypassed = false,
  blockingReasons = [],
  validatedEvidence = [],
}) {
  return { satisfied, bypassed, blockingReasons, validatedEvidence };
}

/**
 * Decides a single rule. Returns the blocking reason, or null when the rule is
 * fulfilled.
 */
function evaluateRule(configuredRule, accessPoint, evidenceByType) {
  const rule = getValidationRule(configuredRule.type);

  if (!rule || !AccessEvidenceService.hasPreconditions(rule, accessPoint)) {
    return ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE;
  }

  const evidence = evidenceByType.get(rule.type);

  if (!evidence) {
    return ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING;
  }

  return rule.verify(evidence, accessPoint)
    ? null
    : ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID;
}

/**
 * Reduce the evidence list to one entry per type. The first entry of a type
 * wins, so a client cannot improve its chances by sending a type twice.
 */
function indexEvidenceByType(evidence) {
  const byType = new Map();

  for (const entry of Array.isArray(evidence) ? evidence : []) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.type !== "string" ||
      byType.has(entry.type)
    ) {
      continue;
    }

    byType.set(entry.type, entry);
  }

  return byType;
}

module.exports = {
  decide,
  satisfy,
  demandedEvidenceOf,
};
