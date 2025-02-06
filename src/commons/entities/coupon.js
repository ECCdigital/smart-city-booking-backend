const { Double } = require("mongodb");

class Coupon {
  constructor({
    id,
    amount,
    description,
    discount,
    maxAmount,
    tenantId,
    type,
    usedAmount,
    validFrom,
    validTo,
    ownerUserId,
  }) {
    this.id = id;
    this.amount = amount;
    this.description = description;
    this.discount = discount;
    this.maxAmount = maxAmount;
    this.tenantId = tenantId;
    this.type = type;
    this.usedAmount = usedAmount;
    this.validFrom = validFrom;
    this.validTo = validTo;
    this.ownerUserId = ownerUserId;
  }

  static COUPON_TYPE = {
    PERCENTAGE: "percentage",
    FIXED: "fixed",
  };

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

  static schema() {
    return {
      id: { type: String, required: true },
      amount: { type: Double, default: 0 },
      description: { type: String, default: "" },
      discount: { type: Double, default: 0 },
      maxAmount: { type: Double, default: null },
      tenantId: { type: String, required: true },
      type: { type: String, required: true },
      usedAmount: { type: Double, default: 0 },
      validFrom: { type: Double, default: null },
      validTo: { type: Double, default: null },
      ownerUserId: { type: String, required: true },
    };
  }
}

module.exports = {
  Coupon: Coupon,
};
