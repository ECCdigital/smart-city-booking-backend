/**
 * The enums of the tenant supervision (glossary "Mandanten-Aufsicht"). The
 * one place the string literals are spelled; every other module names them
 * through these.
 */

const { BadRequestError } = require("../../../errors/BaseError");

/**
 * The supervision level of a tenant (glossary "Aufsichtsstufe"): `free`,
 * `supervised`, `pending` (glossary "Freigabe ausstehend": nothing public,
 * everything may be prepared) and `declined` (glossary "abgewiesen":
 * nothing public, and the tenant's own people lose their access - the
 * effect of ticket 15). `PENDING` collides in name with
 * `REVIEW_STATUS.PENDING` and `NOTIFICATION_STATUS.PENDING` on purpose:
 * the value follows the glossary, the enum names what it is about.
 */
const SUPERVISION_LEVELS = Object.freeze({
  FREE: "free",
  SUPERVISED: "supervised",
  PENDING: "pending",
  DECLINED: "declined",
});

/**
 * The levels a self-created tenant may start at (glossary "Startstufe"):
 * never `declined`.
 */
const INITIAL_SUPERVISION_LEVELS = Object.freeze([
  SUPERVISION_LEVELS.FREE,
  SUPERVISION_LEVELS.SUPERVISED,
  SUPERVISION_LEVELS.PENDING,
]);

/**
 * The levels with a public projection (spec §5.2): a positive list, so a
 * level added later is not public until it is named here.
 */
const PUBLIC_SUPERVISION_LEVELS = Object.freeze([
  SUPERVISION_LEVELS.FREE,
  SUPERVISION_LEVELS.SUPERVISED,
]);

/** The review status of an offer (glossary "Prüfstatus"); `null` is "none yet". */
const REVIEW_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

/** What an offer (glossary "Angebot") is: a bookable or an event. */
const OFFER_TYPES = Object.freeze({
  BOOKABLE: "bookable",
  EVENT: "event",
});

/** The event types of the supervision history (glossary "Aufsichtshistorie"). */
const HISTORY_EVENT_TYPES = Object.freeze({
  TENANT_CREATED: "tenant.created",
  // The level a tenant from before the supervision was given by the
  // migration: an initial state, neither a creation nor a change.
  TENANT_LEVEL_INITIALIZED: "tenant.levelInitialized",
  TENANT_LEVEL_CHANGED: "tenant.levelChanged",
  REVIEW_SUBMITTED: "review.submitted",
  REVIEW_APPROVED: "review.approved",
  REVIEW_REJECTED: "review.rejected",
  REVIEW_WITHDRAWN: "review.withdrawn",
});

/** Who acted: a user, or the system. */
const HISTORY_ACTOR_TYPES = Object.freeze({
  USER: "user",
  SYSTEM: "system",
});

/** Where a history row came from. */
const HISTORY_ORIGINS = Object.freeze({
  API: "api",
  MIGRATION: "migration",
});

/** The occasions of a supervision notification (glossary "Mitteilungsanlass"). */
const NOTIFICATION_TYPES = Object.freeze({
  TENANT_SELF_CREATED: "tenant.selfCreated",
  TENANT_LEVEL_CHANGED: "tenant.levelChanged",
  REVIEW_QUEUE_ENTERED: "review.queueEntered",
  REVIEW_DECIDED: "review.decided",
});

/** The delivery status of a notification outbox row. */
const NOTIFICATION_STATUS = Object.freeze({
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
});

const values = (enumeration) => Object.freeze(Object.values(enumeration));

/**
 * The tenant fields the supervision owns: set server-side on creation,
 * changed only by `PUT /tenants/:tenant/supervision`, never taken from a
 * tenant write (spec §3). `supervisionReason` is the reason of the latest
 * level change (glossary "Begründung des jüngsten Stufenwechsels"), set
 * with every actual change - to `null` without one.
 */
const SUPERVISION_FIELDS = Object.freeze([
  "supervisionLevel",
  "supervisionChangedAt",
  "supervisionReason",
]);

/**
 * The effective level of a tenant: what is stored, or `free` for a tenant
 * from before the supervision.
 *
 * @param {Object|null} tenant
 * @returns {string}
 */
function effectiveLevelOf(tenant) {
  return tenant?.supervisionLevel ?? SUPERVISION_LEVELS.FREE;
}

/**
 * The one check of a supervision level that comes from outside.
 *
 * @param {*} level
 * @param {Object} [params] What the error names besides the level;
 *   `params.allowed` narrows the accepted levels (the initial level checks
 *   against `INITIAL_SUPERVISION_LEVELS`) and is named in the error as
 *   given. Default: every level.
 * @returns {string} The level
 * @throws {BadRequestError} `invalid_supervision_level`
 */
function assertSupervisionLevel(
  level,
  { allowed = Object.values(SUPERVISION_LEVELS), ...params } = {},
) {
  if (!allowed.includes(level)) {
    throw new BadRequestError("invalid_supervision_level", {
      ...params,
      level,
      allowed: [...allowed],
    });
  }
  return level;
}

module.exports = {
  SUPERVISION_FIELDS,
  assertSupervisionLevel,
  effectiveLevelOf,
  SUPERVISION_LEVELS,
  SUPERVISION_LEVEL_VALUES: values(SUPERVISION_LEVELS),
  INITIAL_SUPERVISION_LEVELS,
  PUBLIC_SUPERVISION_LEVELS,
  REVIEW_STATUS,
  REVIEW_STATUS_VALUES: values(REVIEW_STATUS),
  OFFER_TYPES,
  OFFER_TYPE_VALUES: values(OFFER_TYPES),
  HISTORY_EVENT_TYPES,
  HISTORY_EVENT_TYPE_VALUES: values(HISTORY_EVENT_TYPES),
  HISTORY_ACTOR_TYPES,
  HISTORY_ACTOR_TYPE_VALUES: values(HISTORY_ACTOR_TYPES),
  HISTORY_ORIGINS,
  HISTORY_ORIGIN_VALUES: values(HISTORY_ORIGINS),
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_VALUES: values(NOTIFICATION_TYPES),
  NOTIFICATION_STATUS,
  NOTIFICATION_STATUS_VALUES: values(NOTIFICATION_STATUS),
};
