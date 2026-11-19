/**
 * The answer of a `…/_meta/<field>` route of the offers, shared by the
 * event and the bookable controllers: each value of a field (the tags, the
 * flags) over the offers within the reach of the request, once. The reach
 * is the one of the route's marker (`*.meta`, ADR 0003): the public's list
 * for the public, the tenant's whole for the staff.
 */

const bunyan = require("bunyan");
const { scopeOf } = require("../../../commons/services/authorization");
const { BaseError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "meta-values-answer.js",
  level: process.env.LOG_LEVEL,
});

/**
 * @param {import("express").Request} request
 * @param {import("express").Response} response
 * @param {import("express").NextFunction} next
 * @param {Object} options
 * @param {string} options.name What the values are, for the log and the 500
 *   ("tags", "flags")
 * @param {function(string, Object): Promise<Object[]>} options.offersOf The
 *   manager's read of the tenant's offers within a scope
 * @param {function(Object): (string[]|undefined)} options.valuesOf The values
 *   of one offer
 * @returns {Promise<void>}
 */
async function answerMetaValues(
  request,
  response,
  next,
  { name, offersOf, valuesOf },
) {
  try {
    const tenant = request.params.tenant;
    const offers = await offersOf(tenant, scopeOf(request));
    const values = [...new Set(offers.flatMap(valuesOf))];

    logger.info(
      `${tenant} -- sending ${values.length} ${name} to user ${request.user?.id}`,
    );
    response.status(200).send(values);
  } catch (err) {
    if (err instanceof BaseError) {
      return next(err);
    }
    logger.error(err);
    response.status(500).send(`Could not get ${name}`);
  }
}

module.exports = { answerMetaValues };
