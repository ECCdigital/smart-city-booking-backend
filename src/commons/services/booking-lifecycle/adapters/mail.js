/**
 * The mail adapter of the booking lifecycle seam (spec part 2, section
 * 10; mail-stack spec, section 4): one operation, `send(type, ctx)`, which
 * composes the notice (glossary "Mitteilung") of the type over the
 * bookings the lifecycle names and sends every mail of it. The lifecycle
 * names the type, the bookings and the documents it issued; recipients,
 * templates and attachments are the mail module's.
 *
 * A notice nobody gets - the tenant that wants no notice of new bookings,
 * a booker without supervisors - answers `SKIPPED`, and so does a notice
 * the transport skipped as a whole (mail disabled at the instance, spec
 * 5.4). A mail that fails is logged, the remaining mails still go, and the
 * first error is thrown afterwards, for the lifecycle to record.
 */

const bunyan = require("bunyan");
const mailService = require("../../../mail-service");
const { SKIPPED } = require("../pipeline");

const logger = bunyan.createLogger({
  name: "booking-lifecycle-mail.js",
  level: process.env.LOG_LEVEL,
});

const mail = {
  /**
   * @param {string} type A key of the registry (`mail-service/mail-types.js`)
   * @param {Object} ctx The context of `compose`: `{ tenantId, bookingIds,
   *   groupBookingId?, attachments?, ... }`
   * @returns {Promise<Object[]|symbol>} The send outcomes, or `SKIPPED`
   *   where the notice has no recipient or the transport skipped every mail
   */
  async send(type, ctx) {
    const mails = await mailService.compose(type, ctx);
    if (mails.length === 0) {
      return SKIPPED;
    }

    const outcomes = [];
    let failure = null;
    for (const value of mails) {
      try {
        outcomes.push(await mailService.send(value));
      } catch (err) {
        failure = failure ?? err;
        logger.warn(
          `${ctx.tenantId} -- ${type} to ${value.to} failed: ${err.message}`,
        );
      }
    }
    if (failure) {
      throw failure;
    }
    if (outcomes.every((outcome) => outcome.status === "skipped")) {
      return SKIPPED;
    }
    return outcomes;
  },
};

module.exports = mail;
