class Coupon {
  constructor(
    id,
    description,
    type,
    discount,
    maxAmount,
    usedAmount,
    validFrom,
    validTo,
    tenant,
  ) {
    this.id = id;
    this.description = description;
    this.type = type;
    this.discount = discount;
    this.maxAmount = maxAmount;
    this.usedAmount = usedAmount;
    this.validFrom = validFrom;
    this.validTo = validTo;
    this.tenant = tenant;
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
      description: { type: String, required: true },
      type: { type: String, required: true },
      discount: { type: Number, required: true },
      maxAmount: { type: Number, required: false },
      usedAmount: { type: Number, required: false },
      validFrom: { type: Date, required: false },
      validTo: { type: Date, required: false },
      tenant: { type: String, required: true },
    };
  }
}

module.exports = {
  Coupon: Coupon,
};
