const CouponManager = require("../../../../commons/data-managers/coupon-manager");
const {
  COUPON_REASONS,
} = require("../../../../commons/services/coupon/coupon-reasons");
const { CouponError } = require("../../../../errors/CouponError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "coupon.controller.v2.js",
  level: process.env.LOG_LEVEL,
});

class CouponControllerV2 {
  /**
   * Public coupon fields for checkout / validation responses (no internal data).
   */
  static _publicCouponFields(coupon) {
    return {
      id: coupon.id,
      description: coupon.description ?? "",
      discount:
        coupon.discount != null && coupon.discount !== undefined
          ? Number(coupon.discount)
          : 0,
      type: coupon.type,
    };
  }

  /**
   * Mirrors {@link Coupon#isValid} failure cases for a specific reason code.
   */
  static _resolveInvalidReason(coupon) {
    const today = new Date();

    const maxOk =
      coupon.maxAmount === null ||
      coupon.maxAmount === undefined ||
      coupon.maxAmount > coupon.usedAmount;
    if (!maxOk) {
      return {
        reason: COUPON_REASONS.MAX_REDEMPTIONS_REACHED,
        params: {
          maxAmount: Number(coupon.maxAmount),
          usedAmount: Number(coupon.usedAmount),
        },
      };
    }

    if (coupon.validFrom && coupon.validFrom > today) {
      return {
        reason: COUPON_REASONS.NOT_YET_VALID,
        params: { validFrom: coupon.validFrom },
      };
    }

    if (coupon.validTo && coupon.validTo < today) {
      return {
        reason: COUPON_REASONS.EXPIRED,
        params: { validTo: coupon.validTo },
      };
    }

    return { reason: COUPON_REASONS.UNAVAILABLE, params: {} };
  }

  /**
   * Validate a coupon for a tenant. Always responds with HTTP 200;
   * {@link CouponError} cases are returned as JSON with success: false.
   */
  static async validateCoupon(req, res) {
    const tenantId = req.params.tenant;
    const couponId = req.params.id;

    const fail = (couponError) =>
      res.status(200).json(couponError.toJSON());

    if (!couponId) {
      return fail(
        new CouponError({
          reason: COUPON_REASONS.MISSING_PARAMETERS,
          statusCode: 400,
          params: { missing: { id: true } },
        }),
      );
    }

    let coupon;
    try {
      coupon = await CouponManager.getCoupon(couponId, tenantId);
    } catch (err) {
      logger.error({ err, tenantId, couponId }, "validateCoupon: load failed");
      return fail(
        new CouponError({
          reason: COUPON_REASONS.INTERNAL_ERROR,
          statusCode: 500,
          params: {},
        }),
      );
    }

    if (!coupon) {
      return fail(
        new CouponError({
          reason: COUPON_REASONS.NOT_FOUND,
          statusCode: 404,
          params: { couponId },
        }),
      );
    }

    if (!coupon.isValid()) {
      const { reason, params } =
        CouponControllerV2._resolveInvalidReason(coupon);
      logger.info(
        { tenantId, couponId, reason },
        "validateCoupon: coupon not valid",
      );
      return fail(
        new CouponError({
          reason,
          statusCode: 400,
          params: { couponId, ...params },
        }),
      );
    }

    logger.info({ tenantId, couponId }, "validateCoupon: ok");

    return res.status(200).json({
      success: true,
      data: CouponControllerV2._publicCouponFields(coupon),
    });
  }
}

module.exports = CouponControllerV2;
