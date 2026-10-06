const bunyan = require("bunyan");
const UserManager = require("../../data-managers/user-manager");
const UserService = require("../user-service");
const { User, USER_HOOK_TYPES } = require("../../entities/user/user");
const { notify } = require("../../mail-service");
const RateLimiter = require("../rate-limit/rate-limiter");
const limits = require("../rate-limit/limits");
const { TooManyRequestsError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "registration-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The public registration path (spec §6.3): signup and verification resend
 * are rate-limited and answer account-neutrally. Whatever the caller learns
 * from an outcome here must not depend on whether the address has an
 * account: the per-IP limits are the only ones that surface as a 429, the
 * per-account limits and the "account exists" branches end silently.
 */
class RegistrationService {
  /**
   * Signs a user up, or - when the address already has an account - does
   * what is safe instead: an unverified local account gets its verification
   * mail again (within the verification limits), a verified one nothing.
   * Either way nothing tells the caller which branch ran.
   *
   * @param {Object} params
   * @param {User} params.user The account to create
   * @param {string} [params.nextUrl]
   * @param {string} [params.verifyUrl]
   * @param {{ token: string, tenantId: string }|null} [params.invitation]
   * @param {string} params.ip The client IP the signup limit counts against
   * @throws {TooManyRequestsError} Past the per-IP signup limit
   */
  static async signup({ user, nextUrl, verifyUrl, invitation = null, ip }) {
    await RegistrationService._gate(limits.signupPerIp(ip));
    // Validated before the lookup, so a malformed body fails the same way
    // whether or not the address has an account.
    user.validate();

    const existing = await UserManager.getUser(user.id, true);
    if (existing) {
      // A failure surfaces like one of a fresh signup would: the answer
      // must not depend on the branch.
      await RegistrationService._sendVerificationMail(existing, {
        nextUrl,
        verifyUrl,
        ip,
      });
      return;
    }

    await UserService.singUpUser(user, nextUrl, verifyUrl, invitation);
    // The new account's first verification mail counts toward the
    // verification windows, so a resend right after it waits like any other.
    await RateLimiter.consumeAll(
      RegistrationService._verificationLimits(user.id, ip),
    );
  }

  /**
   * Sends the verification mail of an unverified local account again. The
   * per-IP limit answers visibly; the address' own limits and the "no such
   * account" and "already verified" cases end silently.
   *
   * @param {Object} params
   * @param {string} params.id The address
   * @param {string} [params.verifyUrl]
   * @param {string} [params.nextUrl]
   * @param {string} params.ip
   * @throws {TooManyRequestsError} Past the per-IP verification mail limit
   */
  static async requestVerificationMail({ id, verifyUrl, nextUrl, ip }) {
    await RegistrationService._gate(limits.verificationMailPerIp(ip));

    const user = await UserManager.getUser(id, true);
    try {
      await RegistrationService._sendVerificationMail(user, {
        nextUrl,
        verifyUrl,
        // The IP limit is already spent above; only the account's own remain.
        ip: null,
      });
    } catch (error) {
      // An unknown address never fails here, so a known one must not either.
      logger.error(
        { err: error },
        `Could not send the verification mail for ${id}`,
      );
    }
  }

  static async _gate(limit) {
    const gate = await RateLimiter.consume(limit);
    if (!gate.allowed) {
      throw new TooManyRequestsError("too_many_requests", {
        retryAfterSeconds: gate.retryAfterSeconds,
      });
    }
  }

  static _verificationLimits(id, ip) {
    return [
      ...limits.verificationMailPerAccount(id),
      ...(ip ? [limits.verificationMailPerIp(ip)] : []),
    ];
  }

  /**
   * Mails a fresh verification link when the account can use one and its
   * limits allow it; otherwise does nothing. A failed send gives the
   * reservation back and rethrows; the caller decides what the failure may
   * tell.
   *
   * @returns {Promise<boolean>} Whether a mail went out
   */
  static async _sendVerificationMail(user, { nextUrl, verifyUrl, ip }) {
    if (
      !user ||
      user.isVerified ||
      user.isSuspended ||
      (user.authType && user.authType !== "local")
    ) {
      return false;
    }

    const gate = await RateLimiter.consumeAll(
      RegistrationService._verificationLimits(user.id, ip),
    );
    if (!gate.allowed) {
      return false;
    }

    try {
      const entity = user instanceof User ? user : new User(user);
      entity.revokeActiveHooks(USER_HOOK_TYPES.VERIFY);
      const hook = entity.addHook(USER_HOOK_TYPES.VERIFY, {
        nextUrl,
        verifyUrl,
      });
      await UserManager.updateUser(entity);
      await notify("VERIFICATION_REQUEST", {
        to: entity.id,
        hookId: hook.id,
        verifyUrl,
      });
      return true;
    } catch (error) {
      await gate.release();
      throw error;
    }
  }
}

module.exports = RegistrationService;
