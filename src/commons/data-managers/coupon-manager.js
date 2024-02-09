const dbm = require("../utilities/database-manager");
const { Coupon } = require("../entities/coupon");

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
  static getCoupon(couponId, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("coupons")
        .findOne({ id: couponId, tenant: tenant })
        .then((rawCoupon) => {
          const coupon = Object.assign(new Coupon(), rawCoupon);
          resolve(coupon);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all coupons related to a tenant.
   *
   * @param tenant
   */
  static getCoupons(tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("coupons")
        .find({ tenant: tenant })
        .toArray()
        .then((rawCoupons) => {
          const coupons = rawCoupons.map((rc) => {
            return Object.assign(new Coupon(), rc);
          });
          resolve(coupons);
        })
        .catch((err) => reject(err));
    });
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
      while (!isUnique) {
        coupon.id = Math.random().toString(36).substring(2, 10);
        isUnique = dbm
          .get()
          .collection("coupons")
          .findOne({ id: coupon.id, tenant: coupon.tenant })
          .then((rawCoupon) => {
            return rawCoupon === null;
          });
      }
    }

    if (!coupon._id) {
      coupon.usedAmount = 0;
      const rawCoupon = await dbm
        .get()
        .collection("coupons")
        .findOne({ id: coupon.id, tenant: coupon.tenant });
      if (rawCoupon) {
        throw new Error("Coupon id already exists");
      }
    }

    if (coupon._id) delete coupon._id;

    if (coupon.maxAmount && !Number.isInteger(coupon.maxAmount)) {
      coupon.maxAmount = parseInt(coupon.maxAmount);
    }

    try {
      await dbm
        .get()
        .collection("coupons")
        .replaceOne({ id: coupon.id, tenant: coupon.tenant }, coupon, {
          upsert: upsert,
        });
      return await this.getCoupon(coupon.id, coupon.tenant);
    } catch (err) {
      logger.error(err);
      return err;
    }
  }

  /**
   * Remove a coupon.
   *
   * @param couponId
   * @param tenant
   */
  static removeCoupon(couponId, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("coupons")
        .deleteOne({ id: couponId, tenant: tenant })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
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
    const coupon = await this.getCoupon(couponId, tenant);
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
    await this.storeCoupon(coupon, false);

    return discountedPrice;
  }
}

module.exports = CouponManager;
