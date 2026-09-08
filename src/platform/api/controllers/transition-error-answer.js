/**
 * The answer to an error of a lifecycle transition, shared by the booking
 * and the group booking controllers (spec part 1, 4.3): the lifecycle's
 * guard - the booking is not in the state the transition needs, or a
 * second transition raced this one (409) - and a missing booking, group or
 * tenant (404) answer with their status; an aborted transition is the
 * error code of before, a 500; everything else the plain 500.
 */

const bunyan = require("bunyan");
const {
  LifecycleError,
} = require("../../../commons/services/booking-lifecycle");
const { BaseError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "transition-error-answer.js",
  level: process.env.LOG_LEVEL,
});

/**
 * @param {Error} err What the transition threw
 * @param {import("express").Response} response
 * @param {Object} options
 * @param {string} options.code The error code an aborted transition answers
 * @param {string|Object|function(Error): (string|Object)} options.fallback
 *   The body of the 500, or a function of the error that makes it
 * @param {function(BaseError): Object} [options.body] The body of an answer
 *   under 500; the error's JSON form unless the endpoint keeps another
 */
function answerTransitionError(
  err,
  response,
  { code, fallback, body = (error) => error.toJSON() },
) {
  const error =
    err instanceof LifecycleError
      ? new BaseError(code, 500, { message: err.message })
      : err;
  logger.error(error);
  if (response.headersSent) {
    return;
  }
  if (error instanceof BaseError && error.statusCode < 500) {
    return response.status(error.statusCode).send(body(error));
  }
  response
    .status(500)
    .send(typeof fallback === "function" ? fallback(error) : fallback);
}

module.exports = { answerTransitionError };
