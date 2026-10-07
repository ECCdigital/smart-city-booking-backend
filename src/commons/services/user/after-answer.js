const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "after-answer.js",
  level: process.env.LOG_LEVEL,
  serializers: { err: bunyan.stdSerializers.err },
});

/** The work under way; `whenIdle` lets a test wait for it. */
const inFlight = new Set();

/**
 * Runs work after the answer of an account-neutral entry point (signup,
 * verification resend, forgot password; ECCdigital/tickets#259): looking up
 * the address, creating the account and sending its mail never delay the
 * answer, so neither its time nor its status tells whether the address has
 * an account. What fails is logged, never answered.
 *
 * @param {() => Promise<*>} work
 * @param {string} what What the work does, for the log
 */
function afterAnswer(work, what) {
  const running = new Promise((resolve) => setImmediate(resolve))
    .then(work)
    .catch((error) => logger.error({ err: error }, `${what} failed`))
    .finally(() => inFlight.delete(running));
  inFlight.add(running);
}

/** Resolves once every work under way has settled. */
async function whenIdle() {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

module.exports = { afterAnswer, whenIdle };
