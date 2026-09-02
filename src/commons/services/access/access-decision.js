const {
  ACCESS_BLOCKING_REASONS,
  prioritizeBlockingReasons,
} = require("./access-blocking-reasons");
const { getValidationRule } = require("./access-validation-rules");
const AccessEvidenceService = require("./access-evidence-service");
const PermissionsService = require("../permission-service");
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
 * and whether the booking is theirs is read off the loaded booking with the
 * ownership rule of the permission service.
 *
 * @typedef {Object} AccessPointEntry An access point of a booking, as the
 *   resolver pairs it with the booking context it was resolved with
 * @property {Object} accessPoint The access point - `id`, `type`, `mode` and
 *   its rules (`validationRules`: the configured rules, `[]` for none, `null`
 *   where nobody can see them)
 * @property {Object} bookingContext What the booking adds to it -
 *   `accessBuffer`, `isProvisioned`, `revokedAt`, `grant`
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
 *   mode allows an open through the API - the set open/unlatch check against
 * @property {boolean} evidenceWaived Whether the evidence rules do not apply
 *   to this person - only to the management at somebody else's booking
 * @property {Object<string, string[]>} demandedEvidence The rule types each
 *   access point demands of this person, by access point id
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
 *   the bookings of the tenant. Replaces ownership; it never bypasses the
 *   booking conditions
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
  const demandedEvidence = {};

  let anyInWindow = false;
  let anyRevoked = false;
  let anyUnprovisioned = false;
  let anyAuthorizationUsable = false;
  let anyRemoteCapable = false;

  for (const { accessPoint, bookingContext } of accessPoints) {
    const id = String(accessPoint.id);
    const beforeMs = bookingContext.accessBuffer?.beforeMs ?? 0;
    const afterMs = bookingContext.accessBuffer?.afterMs ?? 0;
    const inWindow =
      booking.timeBegin - beforeMs <= now && booking.timeEnd + afterMs >= now;

    demandedEvidence[id] = evidenceWaived
      ? []
      : demandedEvidenceOf(accessPoint);

    if (inWindow) {
      anyInWindow = true;
    }
    if (supportsRemote(accessPoint.mode)) {
      anyRemoteCapable = true;
    }

    // Lockers are provisioned by their very existence: the box was assigned
    // with the booking. Only doors carry a grant that can be missing or
    // withdrawn.
    const isLocker = accessPoint.type === AccessPointType.LOCKER;
    const revokedAt = isLocker ? null : bookingContext.revokedAt ?? null;
    if (revokedAt) {
      anyRevoked = true;
    }

    // A door that only takes a code is nothing without the code: no grant or
    // a revoked one locks it. A door that also opens remotely stays operable
    // meanwhile, and the missing or revoked grant is a hint at it.
    let authorizationUsable = false;
    const takesCodeOnly = accessPoint.mode === AccessPointMode.AUTHORIZATION;
    if (!isLocker && usesAuthorization(accessPoint.mode)) {
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
    const lockedForWantOfGrant = takesCodeOnly && !authorizationUsable;

    if (!isValid || !inWindow || !hasRole || lockedForWantOfGrant) {
      continue;
    }

    operableAccessPointIds.push(id);
    if (supportsRemote(accessPoint.mode)) {
      remoteOperableAccessPointIds.push(id);
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
    evidenceWaived,
    demandedEvidence,
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
 * Lockers demand no evidence. The management is waived the rules of a door
 * (`decision.evidenceWaived`), which is recorded as a bypass only where there
 * were rules to bypass.
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
  if (accessPoint.type === AccessPointType.LOCKER) {
    return evidenceOutcome({ satisfied: true });
  }

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
 * its rules, without their configuration. Lockers demand nothing - they are
 * never asked for evidence. Where the rules are unknown there is nothing to
 * name either; {@link satisfy} is what keeps that door shut.
 *
 * @param {Object} accessPoint The access point, with its `validationRules`
 * @returns {string[]} The distinct rule types
 */
function demandedEvidenceOf(accessPoint) {
  if (accessPoint.type === AccessPointType.LOCKER) {
    return [];
  }

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
  const isOwnBooking = Boolean(
    userId && PermissionsService._isOwner(booking, userId, booking.tenantId),
  );

  if (isOwnBooking) {
    return "booker";
  }

  return canManage ? "manager" : null;
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
