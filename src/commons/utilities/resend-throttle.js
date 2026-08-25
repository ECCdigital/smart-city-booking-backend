// Per-process resend cooldown; arm() before any existence check (no enumeration).
const COOLDOWN_MS = 60 * 1000;

function createResendThrottle() {
  const lastResend = new Map();

  function assertNotThrottled(key) {
    const lastSent = lastResend.get(key);
    if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
      const retryAfter = Math.ceil(
        (COOLDOWN_MS - (Date.now() - lastSent)) / 1000,
      );
      throw {
        message: `Please wait ${retryAfter}s before requesting another verification email`,
        status: 429,
      };
    }
  }

  function arm(key) {
    lastResend.set(key, Date.now());
    setTimeout(() => lastResend.delete(key), COOLDOWN_MS).unref();
  }

  return { assertNotThrottled, arm };
}

module.exports = { createResendThrottle };
