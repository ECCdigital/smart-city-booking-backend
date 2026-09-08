/**
 * The in-memory adapter of the transport (glossary "Versandweg"): no wire,
 * every mail it is asked to send is recorded in `sent`, in order, as the
 * nodemailer mail options plus a `messageId`. Made to fail, it refuses
 * every send the way an unreachable server would and counts the refusals.
 *
 * The third implementation of the transport contract
 * (`tests/mail-transport-contract.test.js`), exported for tests only -
 * `MailerService` never picks it by itself; a test puts it in through
 * `tests/helpers/in-memory-mail-transport.js`.
 */
class InMemoryMailTransport {
  /**
   * @param {Object} [options]
   * @param {string|null} [options.failure=null] The message every send
   *   fails with; null for a transport that delivers
   */
  constructor({ failure = null } = {}) {
    this.failure = failure;
    this.reset();
  }

  /** Forgets everything sent and refused so far. */
  reset() {
    /** @type {Object[]} every mail sent, in order */
    this.sent = [];
    /** How many sends were refused. */
    this.refused = 0;
    this.nextId = 1;
  }

  async sendMail(options) {
    if (this.failure) {
      this.refused += 1;
      throw new Error(this.failure);
    }
    const messageId = `<in-memory-${this.nextId++}@example.test>`;
    this.sent.push({ ...options, messageId });
    return {
      messageId,
      accepted: [options.to].concat(options.bcc ? [options.bcc] : []),
      rejected: [],
    };
  }

  close() {}
}

function createInMemoryTransport(options) {
  return new InMemoryMailTransport(options);
}

module.exports = { createInMemoryTransport, InMemoryMailTransport };
