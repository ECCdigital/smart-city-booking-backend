/**
 * The rules every call to a geo provider shares (map
 * ECCdigital/tickets#372), for search and reverse search
 * (`geo-service.js`) as for the tiles (`tile-service.js`) and their
 * adapters:
 *
 * - an attempt past a limit is refused with `503` and `Retry-After`,
 * - a failed answer of the provider is refused with `503`,
 * - a found answer is kept unless the cache is full,
 * - the answer of the geo client is read the same way by every adapter:
 *   no answer is its outcome, `429` is `throttled`, any other status but
 *   `200` is `status`.
 *
 * The logs name the kind of request, the limit and the failure, never what
 * was asked.
 */

const bunyan = require("bunyan");

const RateLimiter = require("../rate-limit/rate-limiter");
const { ServiceUnavailableError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "geo-provider-rules.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Counts one attempt against a limit of the geo services.
 *
 * @param {Object} params
 * @param {Object} params.limit A limit of `limits.js`
 * @param {string} params.code The code of the refusal
 * @param {string} params.kind `search`, `reverse` or `tiles`, for the log
 * @param {string} params.name `perUser` or `outbound`, for the log
 * @throws {ServiceUnavailableError} `code`, with `retryAfterSeconds`, past
 *   the limit
 */
async function consume({ limit, code, kind, name }) {
  const slot = await RateLimiter.consume(limit);
  if (!slot.allowed) {
    logger.warn({ kind, limit: name }, "geo limit reached");
    throw new ServiceUnavailableError(code, {
      retryAfterSeconds: slot.retryAfterSeconds,
    });
  }
}

/**
 * The refusal for want of the provider, logged by its kind of failure.
 *
 * @param {Object} params
 * @param {string} params.code The code of the refusal
 * @param {string} params.kind `search`, `reverse` or `tiles`, for the log
 * @param {string} params.failure The failure of the adapter
 * @returns {ServiceUnavailableError} To throw
 */
function unavailable({ code, kind, failure }) {
  logger.warn({ kind, failure }, "geo provider failed");
  return new ServiceUnavailableError(code);
}

/**
 * Keeps an answer unless the cache is full: then it is answered, not kept.
 *
 * @param {import("node-cache")} cache The cache
 * @param {string} key The key
 * @param {*} value The answer
 */
function remember(cache, key, value) {
  try {
    cache.set(key, value);
  } catch {
    // ECACHEFULL: answered, not kept.
  }
}

/**
 * The failure of a call of the geo client, `null` for an answer `200`.
 *
 * @param {Object} result The result of `GeoClient.get`
 * @returns {?("timeout"|"unreachable"|"throttled"|"status")} The failure
 */
function failureOf(result) {
  if (result.outcome !== "response") return result.outcome;
  if (result.status === 429) return "throttled";
  if (result.status !== 200) return "status";
  return null;
}

module.exports = { consume, unavailable, remember, failureOf };
