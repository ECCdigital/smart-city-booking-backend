const { BaseError } = require("./BaseError");

/**
 * The provider cannot reach the lock right now (Nuki: `serverState`
 * offline). Not Lock Busy - nothing was understood and nothing will be
 * carried out - and not a refusal of the platform: the lock's connection
 * on site is down. The provider's last known state of the lock is not the
 * status either, so a status read fails with this rather than passing the
 * stale state off as current. Goes out as a real HTTP 503 with
 * `code: "lock_unreachable"`, so the client can say the lock is
 * unreachable instead of offering to lock it.
 */
class LockUnreachableError extends BaseError {
  /**
   * @param {string} provider The provider that reported the lock offline
   * @param {"open"|"close"|"status"} action The command that could not be
   *   carried out
   * @param {string} [message] Full detail for the audit log
   */
  constructor(provider, action, message) {
    super("lock_unreachable", 503, { provider, action });
    this.name = "LockUnreachableError";
    if (message) {
      this.message = message;
    }
  }
}

module.exports = { LockUnreachableError };
