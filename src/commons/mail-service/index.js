/**
 * The mail module at its seam (mail-stack spec, section 2): two
 * operations, nothing in between.
 *
 *   compose(type, ctx)  →  Promise<Mail[]>      loads once, renders, resolves recipients
 *   send(mail)          →  Promise<SendOutcome> chooses the transport, sends with retry
 *
 * `notify` is the two in a row - every mail of a composed notice sent -
 * for the callers outside the booking lifecycle, whose mail adapter does
 * the same under the lifecycle's failure policy.
 */

const { compose } = require("./compose");
const MailerService = require("./mail-service");

const send = (mail) => MailerService.send(mail);

/**
 * Composes a notice and sends every mail of it.
 *
 * @param {string} type A key of the registry (`mail-types.js`)
 * @param {Object} ctx The context of `compose`
 * @returns {Promise<Object[]>} The send outcomes, one per mail
 */
async function notify(type, ctx) {
  const outcomes = [];
  for (const mail of await compose(type, ctx)) {
    outcomes.push(await send(mail));
  }
  return outcomes;
}

module.exports = { compose, send, notify };
