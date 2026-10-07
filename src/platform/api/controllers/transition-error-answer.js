/**
 * The answer to an error of a lifecycle transition, shared by the booking
 * and the group booking controllers (spec part 1, 4.3): the lifecycle's
 * guard - the booking is not in the state the transition needs, or a
 * second transition raced this one (409) - and a missing booking, group or
 * tenant (404) answer with their status; an aborted transition is the
 * error code of before, a 500; everything else the plain 500. Where the
 * endpoint asks for it, a transition aborted because the stored booking does
 * not pass its schema answers that `ValidationError` instead (400, `details`
 * naming field and code), so the administration learns the reason.
 */

const bunyan = require("bunyan");
const {
  LifecycleError,
} = require("../../../commons/services/booking-lifecycle");
const { BaseError } = require("../../../errors/BaseError");
const { ValidationError } = require("../../../errors/ValidationError");

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
 * @param {boolean} [options.answerValidationError] Whether an abort caused by
 *   a `ValidationError` of the stored booking answers that error
 */
function answerTransitionError(
  err,
  response,
  {
    code,
    fallback,
    body = (error) => error.toJSON(),
    answerValidationError = false,
  },
) {
  const aborted = err instanceof LifecycleError;
  let error = err;
  if (
    aborted &&
    answerValidationError &&
    err.cause instanceof ValidationError
  ) {
    error = err.cause;
  } else if (aborted) {
    error = new BaseError(code, 500, { message: err.message });
  }
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
