const { couponSchemaDefinition } = require("../../schemas/couponSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Coupon {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(couponSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  static COUPON_TYPE = {
    PERCENTAGE: "percentage",
    FIXED: "fixed",
  };

  /**
   * Check if the coupon is valid
   * @returns {boolean} True if the coupon is valid
   */
  isValid() {
    const today = new Date();
    return (
      (this.maxAmount === null ||
        this.maxAmount === undefined ||
        this.maxAmount > this.usedAmount) &&
      (!this.validFrom || this.validFrom <= today) &&
      (!this.validTo || this.validTo >= today)
    );
  }

  /**
   * Validate the coupon
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, couponSchemaDefinition);
    return true;
  }

  /**
   * Create a new coupon
   * @param {Object} params Coupon parameters
   * @returns {Coupon} The created coupon
   */
  static create(params) {
    const coupon = new Coupon(params);
    coupon.validate();
    return coupon;
  }
}

module.exports = {
  Coupon,
  COUPON_TYPE: Coupon.COUPON_TYPE,
};
