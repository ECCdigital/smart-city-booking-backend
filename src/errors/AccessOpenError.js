const { BaseError } = require("./BaseError");

/**
 * An open attempt that failed after the eligibility and evidence checks
 * passed. Guests are told only the failure class - `temporary` ("try again in
 * a few minutes") or `configuration` ("contact the administration") - never a
 * provider detail. The `message` carries the full detail for the audit log
 * and the admin view.
 */
class AccessOpenError extends BaseError {
  /**
   * @param {"temporary"|"configuration"} failureClass What the guest may be
   *   told
   * @param {string} message Full detail for audit log and admin view
   * @param {Object} [params]
   */
  constructor(failureClass, message, params = {}) {
    super(
      failureClass === "temporary"
        ? "open_temporarily_unavailable"
        : "open_not_possible",
      failureClass === "temporary" ? 503 : 409,
      params,
    );
    this.name = "AccessOpenError";
    this.failureClass = failureClass;
    if (message) {
      this.message = message;
    }
  }

  static temporary(message, params = {}) {
    return new AccessOpenError("temporary", message, params);
  }

  static configuration(message, params = {}) {
    return new AccessOpenError("configuration", message, params);
  }
}

module.exports = { AccessOpenError };
