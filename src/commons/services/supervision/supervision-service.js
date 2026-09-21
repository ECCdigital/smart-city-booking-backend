/**
 * The supervision level of a tenant (glossary "Aufsichtsstufe"): the one
 * place it is set. `changeTenantLevel` is the instance owner's explicit
 * change (spec §2, §6.2), `initialLevelForCreation` the level a new tenant
 * starts at (§2 "Startstufe").
 */

const bunyan = require("bunyan");
const TenantManager = require("../../data-managers/tenant-manager");
const SupervisionHistoryManager = require("../../data-managers/supervision-history-manager");
const SupervisionNotificationService = require("./supervision-notification-service");
const {
  SUPERVISION_LEVELS,
  effectiveLevelOf,
  SUPERVISION_LEVEL_VALUES,
  REVIEW_STATUS,
  HISTORY_EVENT_TYPES,
  HISTORY_ACTOR_TYPES,
  HISTORY_ORIGINS,
  NOTIFICATION_TYPES,
} = require("./supervision-constants");
const { normalizeReason } = require("./reason");
const ReviewService = require("./review-service");
const {
  BadRequestError,
  NotFoundError,
  ConflictError,
} = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "supervision-service.js",
  level: process.env.LOG_LEVEL,
});

class SupervisionService {
  /**
   * Sets the level of a tenant. Validates the level, writes it
   * conditionally on the level the tenant was read at (a concurrent change
   * is a conflict, never a lost update), and - only when the level actually
   * changed - writes one history row and records one notification
   * occasion. Setting the level that is already effective is a no-op: no
   * history, no occasion, the stored change time stays.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.level One of `SUPERVISION_LEVELS`
   * @param {string|null} [params.reason] Optional reason, stored with the row
   * @param {string|null} params.actorUserId Who changes it (server-determined)
   * @param {Date} [params.now] The change time; default: now
   * @returns {Promise<{supervisionLevel: string, supervisionChangedAt: Date|null}>}
   *   The effective level and its change time
   * @throws {BadRequestError} `invalid_supervision_level` for an unknown level
   * @throws {NotFoundError} `tenant_not_found`
   * @throws {ConflictError} `supervision_level_changed` when the level moved
   *   underneath the caller
   */
  static async changeTenantLevel({
    tenantId,
    level,
    reason,
    actorUserId,
    now = new Date(),
  }) {
    if (!SUPERVISION_LEVEL_VALUES.includes(level)) {
      throw new BadRequestError("invalid_supervision_level", {
        level,
        allowed: SUPERVISION_LEVEL_VALUES,
      });
    }
    const storedReason = normalizeReason(reason, "invalid_supervision_reason");

    const tenant = await TenantManager.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { id: tenantId });
    }

    const from = effectiveLevelOf(tenant);
    if (from === level) {
      return {
        supervisionLevel: from,
        supervisionChangedAt: tenant.supervisionChangedAt ?? null,
      };
    }

    const updated = await TenantManager.updateSupervisionLevel({
      tenantId,
      from,
      to: level,
      changedAt: now,
    });
    if (!updated) {
      throw new ConflictError("supervision_level_changed", {
        tenantId,
        expected: from,
      });
    }

    // History and occasion follow the successful write. An explicit change
    // carries no dedupe key: a repeated request finds the level effective
    // and ends as the no-op above.
    await SupervisionHistoryManager.insert({
      tenantId,
      offerType: null,
      offerId: null,
      eventType: HISTORY_EVENT_TYPES.TENANT_LEVEL_CHANGED,
      occurredAt: now,
      actor: { type: HISTORY_ACTOR_TYPES.USER, userId: actorUserId ?? null },
      from,
      to: level,
      reason: storedReason,
      origin: HISTORY_ORIGINS.API,
    });
    await SupervisionNotificationService.recordAndDispatch({
      type: NOTIFICATION_TYPES.TENANT_LEVEL_CHANGED,
      tenantId,
      payload: {
        tenantName: tenant.name,
        from,
        to: level,
        reason: storedReason,
        actorUserId: actorUserId ?? null,
        changedAt: now,
      },
      createdAt: now,
    });

    // The offers already pending enter the active review queue with the
    // switch to `supervised` (spec §8): one occasion for all of them, none
    // without any. A switch away announces nothing, and no switch ever
    // touches a review (§2).
    // The offers are read after the write: a submission racing the switch
    // is announced twice at worst, never lost. A failure here never undoes
    // or fails the change that already happened (§8) - it is logged.
    if (level === SUPERVISION_LEVELS.SUPERVISED) {
      try {
        await ReviewService.recordQueueEntry({
          tenantId,
          tenantName: tenant.name,
          cause: HISTORY_EVENT_TYPES.TENANT_LEVEL_CHANGED,
          entries: await ReviewService.listOffersByReviewStatus(
            tenantId,
            REVIEW_STATUS.PENDING,
          ),
          now,
        });
      } catch (error) {
        logger.error(
          { err: error, tenantId },
          "could not record the queue entry of the pending offers after the switch to supervised",
        );
      }
    }

    return {
      supervisionLevel: updated.supervisionLevel,
      supervisionChangedAt: updated.supervisionChangedAt,
    };
  }

  /**
   * The level a new tenant starts at (spec §2): a tenant the instance owner
   * creates is always free; a self-creation starts at the instance's
   * initial level, `free` when the instance names none.
   *
   * @param {Object} params
   * @param {Object|null} params.instance The instance record
   * @param {boolean} params.creatorIsInstanceOwner
   * @returns {string} One of `SUPERVISION_LEVELS`
   */
  static initialLevelForCreation({ instance, creatorIsInstanceOwner }) {
    if (creatorIsInstanceOwner) {
      return SUPERVISION_LEVELS.FREE;
    }
    const level = instance?.tenantInitialSupervisionLevel;
    return SUPERVISION_LEVEL_VALUES.includes(level)
      ? level
      : SUPERVISION_LEVELS.FREE;
  }
}

module.exports = SupervisionService;
