/**
 * A mail transport with no wire behind it: `nodemailer.createTransport` is
 * replaced by a transporter that records every mail it is asked to send.
 * It is the third implementation of the transport contract
 * (`mail-transport-contract.test.js`) and the transport the mail
 * characterization runs over.
 *
 * `MailerService` pools its transporters by configuration hash for the
 * lifetime of the process, so a recording transporter made in one test is
 * the one a later test with the same instance configuration gets back.
 * Every transporter therefore writes into the one sink this module holds,
 * and `installInMemoryMailTransport` empties that sink; a test never reads
 * a mail another test sent.
 *
 * Registered in tests only - production never sees it.
 */

const sinon = require("sinon");
const nodemailer = require("nodemailer");

/** @type {Object[]} every mail sent through a recording transporter */
let sink = [];
/** How many sends a broken transporter refused since the install. */
let refused = 0;
let nextId = 1;

/**
 * The transporter `nodemailer.createTransport` answers with: records the
 * nodemailer mail options, or - for a host named `broken` - fails the way
 * an unreachable server would.
 *
 * @param {Object} config The transporter configuration `MailerService` built
 * @returns {{ sendMail: function(Object): Promise<Object>, close: function }}
 */
function recordingTransporter(config) {
  const broken = Boolean(config?.host && /broken/.test(config.host));
  return {
    async sendMail(options) {
      if (broken) {
        refused += 1;
        throw new Error("in-memory mail transport: connection refused");
      }
      const messageId = `<in-memory-${nextId++}@example.test>`;
      sink.push({ ...options, messageId });
      return {
        messageId,
        accepted: [options.to].concat(options.bcc ? [options.bcc] : []),
        rejected: [],
      };
    },
    close() {},
  };
}

/**
 * Replaces `nodemailer.createTransport` for the current test and empties the
 * sink. Restored by `sinon.restore()` like every other stub.
 *
 * @returns {Object[]} The sink: every mail sent from now on, in order, each
 *   the nodemailer mail options (`from`, `to`, `bcc`, `subject`, `html`,
 *   `attachments`) plus a `messageId`
 */
function installInMemoryMailTransport() {
  sink = [];
  refused = 0;
  sinon.stub(nodemailer, "createTransport").callsFake(recordingTransporter);
  return sink;
}

/** The mails sent since the transport was installed. */
function sentMails() {
  return sink;
}

/** The sends a broken transporter refused since the transport was installed. */
function refusedSends() {
  return refused;
}

module.exports = { installInMemoryMailTransport, sentMails, refusedSends };
