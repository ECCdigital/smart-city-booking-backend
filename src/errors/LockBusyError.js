const { BaseError } = require("./BaseError");

/**
 * The provider refused a command because the lock is still carrying out
 * the previous one (Nuki: HTTP 423). Not an unreachable lock and not a rate
 * limit: the command was understood, the lock just cannot take it yet. The
 * client answers by waiting out its cooldown, so this leaves the "refusals
 * stay on 200" pattern and goes out as a real HTTP 423. It carries no
 * retry-after hint on purpose - the wait is the client's own constant.
 */
class LockBusyError extends BaseError {
  /**
   * @param {string} provider The provider that reported the busy lock
   * @param {"open"|"unlatch"|"close"} action The command that was refused
   * @param {string} [message] Full detail for the audit log
   */
  constructor(provider, action, message) {
    super("lock_busy", 423, { provider, action });
    this.name = "LockBusyError";
    if (message) {
      this.message = message;
    }
  }
}

module.exports = { LockBusyError };
