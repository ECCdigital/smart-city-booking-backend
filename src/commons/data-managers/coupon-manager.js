const { Coupon } = require("../entities/coupon");

const mongoose = require("mongoose");
const { Schema } = mongoose;

const CouponSchema = new Schema(Coupon.schema());
const CouponModel =
  mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);

/**
 * Data Manager for coupon objects.
 */
class CouponManager {
  /**
   * Get a specific coupon
   *
   * @param couponId
   * @param tenantId
   */
  static async getCoupon(couponId, tenantId) {
    const rawCoupon = await CouponModel.findOne({
      id: couponId,
      tenantId: tenantId,
    });
    if (!rawCoupon) {
      return null;
    }
    return new Coupon(rawCoupon);
  }

  /**
   * Get all coupons related to a tenant.
   *
   * @param tenantId
   */
  static async getCoupons(tenantId) {
    const rawCoupons = await CouponModel.find({ tenantId: tenantId });
    return rawCoupons.map((rc) => new Coupon(rc));
  }

  /**
   * Create a new coupon and store it in the database.
   *
   * @param coupon
   * @param upsert
   */
  static async storeCoupon(coupon, upsert = true) {
    if (coupon.id === undefined) {
      let isUnique = false;

      //TODO: Check if this is the correct way to generate a unique id
      while (!isUnique) {
        coupon.id = Math.random().toString(36).substring(2, 10);
        isUnique = await CouponModel.findOne({
          id: coupon.id,
          tenantId: coupon.tenantId,
        });
      }
    }

    if (!coupon.id) {
      coupon.usedAmount = 0;
      const rawCoupon = await CouponModel.findOne({
        id: coupon.id,
        tenantId: coupon.tenantId,
      });
      if (rawCoupon) {
        throw new Error("Coupon id already exists");
      }
    }

    if (coupon.maxAmount && !Number.isInteger(coupon.maxAmount)) {
      coupon.maxAmount = parseInt(coupon.maxAmount);
    }

    await CouponModel.replaceOne(
      { id: coupon.id, tenantId: coupon.tenantId },
      coupon,
      {
        upsert: upsert,
      },
    );

    return await CouponManager.getCoupon(coupon.id, coupon.tenantId);
  }

  /**
   * Remove a coupon.
   *
   * @param couponId
   * @param tenantId
   */
  static async removeCoupon(couponId, tenantId) {
    await CouponModel.deleteOne({ id: couponId, tenantId: tenantId });
  }

  /**
   * Use a coupon and return the new price.
   *
   * @param couponId
   * @param tenantId
   * @param bookingPrice
   * @returns {Promise<number>}
   */
  static async applyCoupon(couponId, tenantId, bookingPrice) {
    const coupon = await CouponManager.getCoupon(couponId, tenantId);

    if (!coupon) {
      return bookingPrice;
    }

    let discountedPrice = bookingPrice;

    switch (coupon.type) {
      case Coupon.COUPON_TYPE.PERCENTAGE:
        discountedPrice = Math.max(
          0,
          bookingPrice * (1 - coupon.discount / 100),
        ); //.toFixed(2);
        break;
      case Coupon.COUPON_TYPE.FIXED:
        discountedPrice = Math.max(0, bookingPrice - coupon.discount);
        break;
    }

    coupon.usedAmount++;
    await CouponManager.storeCoupon(coupon, false);

    return discountedPrice;
  }
}

module.exports = CouponManager;
