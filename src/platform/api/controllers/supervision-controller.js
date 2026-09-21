const SupervisionService = require("../../../commons/services/supervision/supervision-service");
const ReviewService = require("../../../commons/services/supervision/review-service");
const ReviewQueueService = require("../../../commons/services/supervision/review-queue-service");
const SupervisionHistoryManager = require("../../../commons/data-managers/supervision-history-manager");
const {
  OFFER_TYPE_VALUES,
} = require("../../../commons/services/supervision/supervision-constants");
const { BadRequestError } = require("../../../errors/BaseError");

/**
 * An optional enum query parameter: the value, or undefined when absent.
 *
 * @throws {BadRequestError} for a value outside the enum
 */
function optionalEnum(value, allowed, code) {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!allowed.includes(value)) {
    throw new BadRequestError(code, { value, allowed });
  }
  return value;
}

/**
 * Web controller of the tenant supervision (glossary "Mandanten-Aufsicht",
 * spec §6.2): the level change, the history, the review of an offer and the active
 * review queue. The right is the
 * router's; a handler hands the tenant the route names on and never
 * branches over rights. The instance router is a plain express router, so
 * every handler passes its error to `next` for the central error handler.
 */
class SupervisionController {
  /**
   * `PUT /api/tenants/:tenant/supervision` - sets the level of the tenant.
   * Body: `{ level, reason? }`. Actor and time are the server's.
   */
  static async changeTenantLevel(req, res, next) {
    try {
      const result = await SupervisionService.changeTenantLevel({
        tenantId: req.params.tenant,
        level: req.body?.level,
        reason: req.body?.reason,
        actorUserId: req.principal?.userId ?? null,
      });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * `GET /api/tenants/:tenant/supervision/history` - the history of the
   * tenant the route names, newest first, paginated
   * (`?page=&pageSize=&offerType=&offerId=`).
   */
  static async getTenantHistory(req, res, next) {
    try {
      const result = await SupervisionHistoryManager.list({
        tenantId: req.params.tenant,
        ...SupervisionController._historyFilters(req.query),
      });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * `GET /api/instances/supervision/history` - the instance-wide history,
   * optionally narrowed to one tenant (`?tenantId=`) and one offer.
   */
  static async getInstanceHistory(req, res, next) {
    try {
      const result = await SupervisionHistoryManager.list({
        tenantId: req.query.tenantId || undefined,
        ...SupervisionController._historyFilters(req.query),
      });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * `GET /api/instances/review-queue` - the active review queue (glossary
   * "Aktive Prüfliste"), longest waiting first, paginated
   * (`?page=&pageSize=&tenantId=&offerType=`).
   */
  static async getReviewQueue(req, res, next) {
    try {
      const result = await ReviewQueueService.listActiveReviewQueue({
        tenantId: req.query.tenantId || undefined,
        offerType: optionalEnum(
          req.query.offerType,
          OFFER_TYPE_VALUES,
          "invalid_offer_type",
        ),
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * `POST /api/:tenant/<offers>/:id/review/submissions` - submits the
   * offer for review (glossary "Einreichung"). Takes no body: the status
   * is the transition's, actor and time are the server's. Answers the
   * current review; a repeat on a pending offer is a no-op 200.
   *
   * @param {string} offerType One of `OFFER_TYPES`
   * @returns {import("express").RequestHandler}
   */
  static submitReview(offerType) {
    return async (req, res, next) => {
      try {
        const review = await ReviewService.submit({
          offerType,
          tenantId: req.params.tenant,
          offerId: req.params.id,
          actorUserId: req.principal?.userId ?? null,
        });
        return res
          .status(200)
          .json({ offerType, offerId: req.params.id, review });
      } catch (err) {
        return next(err);
      }
    };
  }

  /**
   * `POST /api/:tenant/<offers>/:id/review/decisions` - the instance
   * owner's decision (glossary "Prüfentscheidung"). Body: `{ action:
   * "approve" | "reject" | "withdraw", reason? }`. Answers the new review.
   *
   * @param {string} offerType One of `OFFER_TYPES`
   * @returns {import("express").RequestHandler}
   */
  static decideReview(offerType) {
    return async (req, res, next) => {
      try {
        const review = await ReviewService.decide({
          offerType,
          tenantId: req.params.tenant,
          offerId: req.params.id,
          action: req.body?.action,
          reason: req.body?.reason,
          actorUserId: req.principal?.userId ?? null,
        });
        return res
          .status(200)
          .json({ offerType, offerId: req.params.id, review });
      } catch (err) {
        return next(err);
      }
    };
  }

  static _historyFilters(query) {
    return {
      offerType: optionalEnum(
        query.offerType,
        OFFER_TYPE_VALUES,
        "invalid_offer_type",
      ),
      offerId: query.offerId || undefined,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

module.exports = SupervisionController;
