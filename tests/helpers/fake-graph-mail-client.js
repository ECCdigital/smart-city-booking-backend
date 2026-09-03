/**
 * Microsoft Graph without Microsoft: the HTTP client the Graph mail
 * transport of `MailerService` posts through (`axios.post`) replaced by an
 * in-memory mailbox, and the MSAL token acquisition answered with a fixed
 * token. Everything above the wire - the transport's mapping of a
 * nodemailer mail to a Graph `sendMail` body, the recipient and
 * attachment conversion - is the production code, so a test through this
 * client exercises the transport and fakes only the network.
 *
 * Anything the fake does not model throws, so it can never quietly answer
 * a request the real API would not.
 */

const sinon = require("sinon");
const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const SEND_MAIL_URL =
  /^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/([^/]+)\/sendMail$/;

/**
 * An error the way axios raises one for an HTTP failure: what the caller
 * sees of an unreachable or refusing Graph.
 */
function graphHttpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

class FakeGraphMailClient {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.broken=false] Whether every send fails the
   *   way Graph answers when the service is down
   */
  constructor({ broken = false } = {}) {
    /** @type {{ user: string, body: Object, authorization: string }[]} */
    this.requests = [];
    this.broken = broken;
  }

  async post(url, body, config = {}) {
    const match = url.match(SEND_MAIL_URL);
    if (!match) {
      throw new Error(`fake graph mail client: unexpected request ${url}`);
    }

    const authorization = config.headers?.Authorization ?? "";
    if (!/^Bearer \S+$/.test(authorization)) {
      throw graphHttpError(401, {
        error: { code: "InvalidAuthenticationToken" },
      });
    }

    if (this.broken) {
      throw graphHttpError(503, { error: { code: "ServiceUnavailable" } });
    }

    this.requests.push({
      user: decodeURIComponent(match[1]),
      body: JSON.parse(body),
      authorization,
    });
    return { status: 202, data: "" };
  }

  /**
   * Puts the fake on the wire for the current test: `axios.post` answers
   * from here, MSAL hands out a fixed token. Restored by `sinon.restore()`.
   *
   * @returns {FakeGraphMailClient} this
   */
  install() {
    sinon.stub(axios, "post").callsFake((...args) => this.post(...args));
    sinon
      .stub(
        ConfidentialClientApplication.prototype,
        "acquireTokenByClientCredential",
      )
      .resolves({ accessToken: "graph-token" });
    return this;
  }
}

module.exports = { FakeGraphMailClient, graphHttpError };
