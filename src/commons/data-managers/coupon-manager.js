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
   * @param tenant
   */
  static async getCoupon(couponId, tenant) {
    const rawCoupon = await CouponModel.findOne({
      id: couponId,
      tenant: tenant,
    });
    return new Coupon(rawCoupon);
  }

  /**
   * Get all coupons related to a tenant.
   *
   * @param tenant
   */
  static async getCoupons(tenant) {
    const rawCoupons = await CouponModel.find({ tenant: tenant });
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
          tenant: coupon.tenant,
        });
      }
    }

    if (!coupon._id) {
      coupon.usedAmount = 0;
      const rawCoupon = await CouponModel.findOne({
        id: coupon.id,
        tenant: coupon.tenant,
      });
      if (rawCoupon) {
        throw new Error("Coupon id already exists");
      }
    }

    if (coupon._id) delete coupon._id;

    if (coupon.maxAmount && !Number.isInteger(coupon.maxAmount)) {
      coupon.maxAmount = parseInt(coupon.maxAmount);
    }

    await CouponModel.replaceOne(
      { id: coupon.id, tenant: coupon.tenant },
      coupon,
      {
        upsert: upsert,
      },
    );

    return await CouponManager.getCoupon(coupon.id, coupon.tenant);
  }

  /**
   * Remove a coupon.
   *
   * @param couponId
   * @param tenant
   */
  static async removeCoupon(couponId, tenant) {
    await CouponModel.deleteOne({ id: couponId, tenant: tenant });
  }

  /**
   * Use a coupon and return the new price.
   *
   * @param couponId
   * @param tenant
   * @param bookingPrice
   * @returns {Promise<number>}
   */
  static async applyCoupon(couponId, tenant, bookingPrice) {
    const coupon = await CouponManager.getCoupon(couponId, tenant);
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
