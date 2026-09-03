/**
 * Puts the in-memory adapter of the transport
 * (`mail-service/transports/in-memory-transport.js`) behind
 * `MailerService.send` for the current test: `MailerService.createTransporter`
 * answers with a recording transport, or - for a no-reply host named
 * `broken` - with one that refuses every send the way an unreachable server
 * would. It is the transport the mail characterization and the third
 * implementation of the transport contract run over.
 *
 * `MailerService` pools its transporters by configuration hash for the
 * lifetime of the process, so a transporter made in one test is the one a
 * later test with the same configuration gets back. Both transports are
 * therefore one instance each for the whole process, and
 * `installInMemoryMailTransport` empties them; a test never reads a mail
 * another test sent.
 */

const sinon = require("sinon");
const MailerService = require("../../src/commons/mail-service/mail-service");
const {
  createInMemoryTransport,
} = require("../../src/commons/mail-service/transports/in-memory-transport");

const recording = createInMemoryTransport();
const broken = createInMemoryTransport({
  failure: "in-memory mail transport: connection refused",
});

/**
 * Replaces `MailerService.createTransporter` for the current test and empties
 * both transports. Restored by `sinon.restore()` like every other stub.
 *
 * @returns {Object[]} The sink: every mail sent from now on, in order, each
 *   the nodemailer mail options (`from`, `to`, `bcc`, `subject`, `html`,
 *   `attachments`) plus a `messageId`
 */
function installInMemoryMailTransport() {
  recording.reset();
  broken.reset();
  sinon
    .stub(MailerService, "createTransporter")
    .callsFake((mailConfig) =>
      /broken/.test(mailConfig?.noreplyHost ?? "") ? broken : recording,
    );
  return recording.sent;
}

/** The mails sent since the transport was installed. */
function sentMails() {
  return recording.sent;
}

/** The sends a broken transporter refused since the transport was installed. */
function refusedSends() {
  return broken.refused;
}

module.exports = { installInMemoryMailTransport, sentMails, refusedSends };
