const { BaseError } = require("./BaseError");

class ValidationError extends BaseError {
  constructor(errors = []) {
    super("validation_failed", 400);
    this.name = "ValidationError";
    this.errors = errors;
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.errors,
    };
  }
}

module.exports = { ValidationError };
