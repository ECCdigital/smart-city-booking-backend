const RateLimitEventManager = require("../../data-managers/rate-limit-event-manager");

/**
 * A sliding-window rate limiter over the `RateLimitEvent` collection, safe
 * across parallel requests and server processes: an attempt is inserted
 * before it is counted, so two racing attempts both see each other and the
 * limit holds without a lock. A denied attempt is taken back at once and
 * does not extend anyone's wait; an allowed one can be given back with
 * `release()` when the guarded action failed after all.
 */
class RateLimiter {
  /**
   * Counts one attempt of `key` against `limit` per `windowMs`.
   *
   * @param {Object} params
   * @param {string} params.key The limited subject, e.g. `signup:ip:203.0.113.7`
   * @param {number} params.limit Attempts allowed per window (≥ 1)
   * @param {number} params.windowMs Length of the sliding window (> 0)
   * @param {Date} [params.now] The clock, for tests
   * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number, release: () => Promise<void> }>}
   *   `retryAfterSeconds` is 0 when allowed, otherwise the seconds until a
   *   slot frees (at least 1).
   */
  static async consume({ key, limit, windowMs, now = new Date() }) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("RateLimiter.consume: key must be a non-empty string");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("RateLimiter.consume: limit must be an integer >= 1");
    }
    if (!(windowMs > 0)) {
      throw new Error("RateLimiter.consume: windowMs must be > 0");
    }

    const since = new Date(now.getTime() - windowMs);
    const id = await RateLimitEventManager.record(key, now);
    const count = await RateLimitEventManager.countSince(key, since);

    if (count <= limit) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        release: () => RateLimitEventManager.remove(id),
      };
    }

    await RateLimitEventManager.remove(id);

    // Without our row there are `count - 1` attempts in the window; a slot
    // frees once `count - limit` of the oldest have left it.
    const freesAt = await RateLimitEventManager.oldestAtWithin(
      key,
      since,
      count - limit - 1,
    );
    const waitMs = freesAt
      ? freesAt.getTime() + windowMs - now.getTime()
      : windowMs;

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      release: async () => {},
    };
  }

  /**
   * Counts one attempt against several limits at once: allowed only when
   * every limit allows it; a denial takes the reservations of the limits
   * before it back, so a denied attempt spends nothing.
   *
   * @param {Array<{ key: string, limit: number, windowMs: number }>} limits
   * @param {Object} [options]
   * @param {Date} [options.now]
   * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number, release: () => Promise<void> }>}
   */
  static async consumeAll(limits, { now = new Date() } = {}) {
    const taken = [];
    for (const limit of limits) {
      const result = await RateLimiter.consume({ ...limit, now });
      if (!result.allowed) {
        await Promise.all(taken.map((t) => t.release()));
        return { ...result, release: async () => {} };
      }
      taken.push(result);
    }
    return {
      allowed: true,
      retryAfterSeconds: 0,
      release: async () => {
        await Promise.all(taken.map((t) => t.release()));
      },
    };
  }
}

module.exports = RateLimiter;
