const { BaseError } = require("./BaseError");

class CouponError extends BaseError {
  constructor({ reason, statusCode = 400, params = {}, checkType = null }) {
    super(reason, statusCode, { ...params, ...(checkType && { checkType }) });
    this.name = "CouponError";
    this.reason = reason;
    this.checkType = checkType;
  }

  toJSON() {
    return {
      success: false,
      error: {
        reason: this.reason,
        checkType: this.checkType,
        params: this.params || {},
      },
    };
  }
}

module.exports = { CouponError };
