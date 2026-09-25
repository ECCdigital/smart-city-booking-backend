const CouponModel = require("./models/couponModel");
const { ownCondition } = require("../services/authorization/reach");
const { REACH } = require("../services/authorization/policy");

/**
 * The condition of a reach on the coupons (ADR 0002). Under `public` there
 * is none: what the public sees of a coupon is the handler's projection
 * (the validation of one code the caller names), so the manager reads the tenant's records whole and the
 * handler shapes them - the offers alone have their projection in the
 * manager (ADR 0003).
 */
const condition = (scope) =>
  scope?.reach === REACH.PUBLIC ? {} : ownCondition("coupon", scope);

/**
 * Data Manager for coupon objects.
 */
class CouponManager {
  /**
   * Check if a coupon exists in the database.
   *
   * @param {string} couponID - Unique ID of the coupon.
   * @param {string} tenantID - Tenant ID.
   * @returns {Promise<boolean>} - True if the coupon exists, false otherwise.
   */
  static async exists(couponID, tenantID) {
    if (!couponID || !tenantID) {
      throw new Error("couponID and tenantID are required.");
    }

    const result = await CouponModel.exists({
      id: couponID,
      tenantId: tenantID,
    });
    return Boolean(result);
  }

  /**
   * Get a specific coupon
   *
   * @param couponID
   * @param tenantID
   */
  static async getCoupon(couponID, tenantID, scope) {
    if (!couponID || !tenantID) {
      throw new Error("couponID and tenantID are required.");
    }

    const rawCoupon = await CouponModel.findOne({
      id: couponID,
      tenantId: tenantID,
      ...condition(scope),
    });

    if (!rawCoupon) {
      return null;
    }

    return rawCoupon.toEntity();
  }

  /**
   * Get all coupons related to a tenant.
   *
   * @param tenantID
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   the domain says `DOMAIN`; none is a programming error
   */
  static async getCoupons(tenantID, scope) {
    if (!tenantID) {
      throw new Error("tenantID is required.");
    }

    const rawCoupons = await CouponModel.find({
      tenantId: tenantID,
      ...condition(scope),
    });
    return rawCoupons.map((doc) => doc.toEntity());
  }

  /**
   * Create a new coupon and store it in the database.
   *
   * @param coupon
   * @param tenantID
   * @param upsert
   */
  static async storeCoupon(coupon, tenantID, upsert = true) {
    if (!coupon || typeof coupon !== "object") {
      throw new Error("coupon object is required.");
    }

    if (!tenantID) {
      throw new Error("tenantID is required.");
    }

    if (coupon.maxAmount != null) {
      const parsed = Number(coupon.maxAmount);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("coupon.maxAmount must be a non-negative number.");
      }
      coupon.maxAmount = Math.trunc(parsed);
    }

    const filter = { id: coupon.id, tenantId: tenantID };
    const options = {
      upsert,
      new: true,
      runValidators: true,
    };

    const updated = await CouponModel.findOneAndUpdate(filter, coupon, options);

    if (!updated) {
      throw new Error("Coupon not found for update.");
    }

    return updated.toEntity();
  }

  static async incrementCouponUsage(couponID, tenantID) {
    if (!couponID || !tenantID) {
      throw new Error("couponID and tenantID are required.");
    }

    const updated = await CouponModel.findOneAndUpdate(
      { id: couponID, tenantId: tenantID },
      { $inc: { usedAmount: 1 } },
      { new: true },
    );

    if (!updated) {
      throw new Error("Coupon not found for incrementing usage.");
    }

    return updated.toEntity();
  }

  static async decrementCouponUsage(couponID, tenantID) {
    if (!couponID || !tenantID) {
      throw new Error("couponID and tenantID are required.");
    }

    const updated = await CouponModel.findOneAndUpdate(
      { id: couponID, tenantId: tenantID },
      { $inc: { usedAmount: -1 } },
      { new: true },
    );

    if (!updated) {
      throw new Error("Coupon not found for decrementing usage.");
    }

    return updated.toEntity();
  }

  /**
   * Remove a coupon.
   *
   * @param couponID
   * @param tenantID
   */
  static async removeCoupon(couponID, tenantID) {
    if (!couponID || !tenantID) {
      throw new Error("couponID and tenantID are required.");
    }

    await CouponModel.deleteOne({ id: couponID, tenantId: tenantID });
  }

  static async reassignOwnerUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await CouponModel.updateMany(
      { ownerUserId: previousUserId },
      { $set: { ownerUserId: newUserId } },
      options,
    );
  }
}

module.exports = CouponManager;
