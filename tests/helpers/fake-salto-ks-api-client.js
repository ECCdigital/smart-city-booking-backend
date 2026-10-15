/**
 * A Salto KS Connect API without the network: the real `SaltoKsApiClient`
 * with token request and HTTP transport replaced by an in-memory site. The
 * client's own logic - site resolution, paging (`{items}`), the error
 * classification the adapter relies on - stays production code.
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not.
 */

const {
  SaltoKsApiClient,
} = require("../../src/commons/services/access/clients/salto-ks-api-client");

// A site UUID, so the client never has to look the site up by reference.
const FAKE_SITE_ID = "8f6a4d2e-0b1c-4d3e-9a7b-1c2d3e4f5a6b";

/**
 * An error the way axios raises one for a Connect API failure. `ErrorCode`
 * and `Message` are what `classifySaltoError` reads.
 */
function saltoHttpError(status, { ErrorCode = null, Message = "" } = {}) {
  return Object.assign(
    new Error(Message || `Request failed with status code ${status}`),
    {
      isAxiosError: true,
      response: { status, data: { ErrorCode, Message } },
    },
  );
}

class FakeSaltoKsApiClient extends SaltoKsApiClient {
  /**
   * @param {Object} [options]
   * @param {Object[]} [options.locks] Locks of the site, as `/locks` lists them
   * @param {Object[]} [options.iqs] IQs of the site, as `/iqs` lists them
   */
  constructor({ locks = [], iqs = [] } = {}) {
    super("client-id", "client-secret", FAKE_SITE_ID, "accept", {
      username: "system-user@example.test",
      password: "password",
    });
    this.locks = new Map(locks.map((lock) => [String(lock.id), lock]));
    this.iqs = new Map(iqs.map((iq) => [String(iq.id), iq]));
    /** What `/me` answers for the system user. */
    this.me = { remote_access: true };
    /** @type {{ lockId: string, otp: string|undefined }[]} every open sent */
    this.openings = [];
    /** An error the next lock opening answers with, e.g. a 403 or an OTP rejection. */
    this.openError = null;
  }

  async _getToken() {
    return "fake-token";
  }

  async _request(method, path, data = null) {
    const prefix = `/v1.2/sites/${FAKE_SITE_ID}`;
    const route = `${method.toUpperCase()} ${path}`;

    if (!path.startsWith(prefix)) {
      throw new Error(`fake-salto-ks-api-client: unexpected request ${route}`);
    }

    const rest = path.slice(prefix.length);
    let match;

    if (rest === "/locks" && method === "get") {
      // Salto pages its collections.
      return { items: [...this.locks.values()] };
    }

    if (rest === "/iqs" && method === "get") {
      return { items: [...this.iqs.values()] };
    }

    if (rest === "/me" && method === "get") {
      return { ...this.me };
    }

    if (
      (match = rest.match(/^\/locks\/([^/]+)\/locking$/)) &&
      method === "patch"
    ) {
      const lock = this.locks.get(match[1]);
      if (!lock) {
        throw saltoHttpError(404, { Message: "Lock not found" });
      }
      if (this.openError) {
        throw this.openError;
      }
      this.openings.push({ lockId: match[1], otp: data?.otp });
      lock.locked_state = "unlocked";
      return { ...lock };
    }

    throw new Error(`fake-salto-ks-api-client: unexpected request ${route}`);
  }
}

/** A Salto client whose every request fails with the given error. */
function brokenSaltoKsApiClient(
  error = saltoHttpError(500, { Message: "Internal error" }),
) {
  const client = new FakeSaltoKsApiClient();
  client._request = async () => {
    throw error;
  };
  return client;
}

/**
 * An OAuth error the way the identity server answers a rejected token
 * request.
 */
function identityError(error) {
  return Object.assign(new Error("Request failed with status code 400"), {
    isAxiosError: true,
    response: { status: 400, data: { error } },
  });
}

/**
 * Puts the fake behind every `SaltoKsApiClient` the code under test builds -
 * for code that constructs its own client, like the connection test. The
 * identity server knows the given accounts: a client of another environment,
 * client id or client secret is `invalid_client`, a wrong system user or
 * password `invalid_grant`. The Connect API is the fake's site.
 *
 * Restore with `sinon.restore()`.
 *
 * @param {Object} sinon The sinon instance the test restores
 * @param {Object} options
 * @param {Object[]} options.accounts `{ environment, clientId, clientSecret,
 *   username, password }` the identity server accepts
 * @param {Object[]} [options.locks]
 * @param {Object[]} [options.iqs]
 * @returns {{ site: FakeSaltoKsApiClient, logins: Object[] }} The site, and
 *   every token request as `{ environment, clientId, username }`
 */
function installFakeSaltoKsConnectApi(sinon, { accounts, locks, iqs } = {}) {
  const site = new FakeSaltoKsApiClient({ locks, iqs });
  const logins = [];

  sinon.stub(SaltoKsApiClient.prototype, "_getToken").callsFake(function () {
    logins.push({
      environment: this.environment,
      clientId: this.clientId,
      username: this.username,
    });
    const client = accounts.find(
      (account) =>
        account.environment === this.environment &&
        account.clientId === this.clientId &&
        account.clientSecret === this.clientSecret,
    );
    if (!client) {
      return Promise.reject(identityError("invalid_client"));
    }
    if (
      client.username !== this.username ||
      client.password !== this.password
    ) {
      return Promise.reject(identityError("invalid_grant"));
    }
    return Promise.resolve("fake-token");
  });
  sinon
    .stub(SaltoKsApiClient.prototype, "_request")
    .callsFake((method, path, data) =>
      FakeSaltoKsApiClient.prototype._request.call(site, method, path, data),
    );

  return { site, logins };
}

module.exports = {
  FakeSaltoKsApiClient,
  installFakeSaltoKsConnectApi,
  brokenSaltoKsApiClient,
  saltoHttpError,
  FAKE_SITE_ID,
};
