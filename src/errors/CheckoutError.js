const { BaseError } = require("./BaseError");

class CheckoutError extends BaseError {
  constructor({ reason, statusCode = 409, params = {}, checkType = null }) {
    super(reason, statusCode, { ...params, ...(checkType && { checkType }) });
    this.name = "CheckoutError";
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

module.exports = { CheckoutError };
