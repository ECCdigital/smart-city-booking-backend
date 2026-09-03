/**
 * The mail module at its seam (mail-stack spec, section 2): two
 * operations, nothing in between.
 *
 *   compose(type, ctx)  →  Promise<Mail[]>      loads once, renders, resolves recipients
 *   send(mail)          →  Promise<SendOutcome> chooses the transport, sends with retry
 */

const { compose } = require("./compose");
const MailerService = require("./mail-service");

module.exports = {
  compose,
  send: (mail) => MailerService.send(mail),
};
