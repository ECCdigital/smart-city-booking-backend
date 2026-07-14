const CouponManager = require("../data-managers/coupon-manager");
const { COUPON_TYPE } = require("../entities/coupon/coupon");
const crypto = require("crypto");

class CouponService {
  static _roundEur(value) {
    return Math.round(value * 100) / 100;
  }

  static async applyCoupon(couponID, tenantID, bookingPrice) {
    if (!couponID) {
      return bookingPrice;
    }

    const coupon = await CouponManager.getCoupon(couponID, tenantID);

    if (!coupon) {
      return bookingPrice;
    }

    let discountedPrice = bookingPrice;

    switch (coupon.type) {
      case COUPON_TYPE.PERCENTAGE:
        discountedPrice = Math.max(
          0,
          bookingPrice * (1 - coupon.discount / 100),
        );
        break;
      case COUPON_TYPE.FIXED:
        discountedPrice = Math.max(0, bookingPrice - coupon.discount);
        break;
    }
    return discountedPrice;
  }

  /**
   * Applies a coupon to checkout prices.
   * Percentage coupons are deducted from net; fixed-amount coupons from gross.
   *
   * @param {string|null} couponID
   * @param {string} tenantID
   * @param {number} netPrice Net price after booking discounts
   * @param {number} vatRate VAT rate as decimal (e.g. 0.19)
   * @returns {Promise<{ netPrice: number, grossPrice: number }>}
   */
  static async applyCouponToCheckoutPrices(
    couponID,
    tenantID,
    netPrice,
    vatRate,
  ) {
    const roundedNet = CouponService._roundEur(netPrice);

    if (!couponID) {
      return {
        netPrice: roundedNet,
        grossPrice: CouponService._roundEur(roundedNet * (1 + vatRate)),
      };
    }

    const coupon = await CouponManager.getCoupon(couponID, tenantID);

    if (!coupon) {
      return {
        netPrice: roundedNet,
        grossPrice: CouponService._roundEur(roundedNet * (1 + vatRate)),
      };
    }

    if (coupon.type === COUPON_TYPE.PERCENTAGE) {
      const discountedNet = CouponService._roundEur(
        Math.max(0, roundedNet * (1 - coupon.discount / 100)),
      );
      return {
        netPrice: discountedNet,
        grossPrice: CouponService._roundEur(discountedNet * (1 + vatRate)),
      };
    }

    if (coupon.type === COUPON_TYPE.FIXED) {
      const grossBeforeCoupon = CouponService._roundEur(
        roundedNet * (1 + vatRate),
      );
      const grossPrice = CouponService._roundEur(
        Math.max(0, grossBeforeCoupon - coupon.discount),
      );
      return {
        netPrice: CouponService._roundEur(grossPrice / (1 + vatRate)),
        grossPrice,
      };
    }

    return {
      netPrice: roundedNet,
      grossPrice: CouponService._roundEur(roundedNet * (1 + vatRate)),
    };
  }

  static async incrementCouponUsage(couponID, tenantID) {
    try {
      if (await CouponManager.exists(couponID, tenantID)) {
        return CouponManager.incrementCouponUsage(couponID, tenantID);
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  static async decrementCouponUsage(couponID, tenantID) {
    try {
      if (await CouponManager.exists(couponID, tenantID)) {
        return CouponManager.decrementCouponUsage(couponID, tenantID);
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  static generateID() {
    return crypto.randomBytes(6).toString("base64url").slice(0, 8);
  }

  static async generateUniqueID(tenantID, maxTries = 5) {
    for (let i = 0; i < maxTries; i++) {
      const id = CouponService.generateID();
      const exists = await CouponManager.exists(id, tenantID);
      if (!exists) {
        return id;
      }
    }
    throw new Error("Failed to generate unique coupon id.");
  }

  static async createCoupon(coupon, tenantID) {
    if (!coupon.id) {
      coupon.id = await CouponService.generateUniqueID(tenantID);
      if (coupon.usedAmount == null) {
        coupon.usedAmount = 0;
      }
    } else {
      const exists = await CouponManager.exists(coupon.id, tenantID);
      if (exists) {
        throw new Error(
          `Coupon with ID ${coupon.id} already exists for tenant ${tenantID}.`,
        );
      }
    }

    return CouponManager.storeCoupon(coupon, tenantID, true);
  }

  static async updateCoupon(coupon, tenantID) {
    if (!coupon.id) {
      throw new Error("Coupon ID is required for update.");
    }

    const exists = await CouponManager.exists(coupon.id, tenantID);
    if (!exists) {
      throw new Error(
        `Coupon with ID ${coupon.id} does not exist for tenant ${tenantID}.`,
      );
    }

    return CouponManager.storeCoupon(coupon, tenantID, false);
  }
}

module.exports = CouponService;
