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
    /** @type {Map<string, Object>} user id -> user */
    this.users = new Map();
    /** @type {Map<string, Object>} access id -> access */
    this.accesses = new Map();
    this.subscriptions = new Map();
    /** @type {{ lockId: string, otp: string|undefined }[]} every open sent */
    this.openings = [];
    /** An error the next lock opening answers with, e.g. a 403 or an OTP rejection. */
    this.openError = null;
    this._nextId = 1;
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

    if (rest === "/users" && method === "post") {
      const id = `user-${this._nextId++}`;
      const user = { id, ...data };
      this.users.set(id, user);
      return user;
    }

    if (
      (match = rest.match(/^\/users\/([^/]+)\/access$/)) &&
      method === "post"
    ) {
      if (!this.users.has(match[1])) {
        throw saltoHttpError(404, { Message: "User not found" });
      }
      const id = `access-${this._nextId++}`;
      const access = { id, userId: match[1], ...data };
      this.accesses.set(id, access);
      return access;
    }

    if ((match = rest.match(/^\/access\/([^/]+)$/)) && method === "delete") {
      if (!this.accesses.delete(match[1])) {
        throw saltoHttpError(404, { Message: "Access not found" });
      }
      return "";
    }

    if ((match = rest.match(/^\/users\/([^/]+)$/)) && method === "delete") {
      if (!this.users.delete(match[1])) {
        throw saltoHttpError(404, { Message: "User not found" });
      }
      return "";
    }

    if (rest === "/subscriptions" && method === "post") {
      const id = `subscription-${this._nextId++}`;
      this.subscriptions.set(id, { id, ...data });
      return { id, ...data };
    }

    if (
      (match = rest.match(/^\/subscriptions\/([^/]+)$/)) &&
      method === "delete"
    ) {
      this.subscriptions.delete(match[1]);
      return "";
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

module.exports = {
  FakeSaltoKsApiClient,
  brokenSaltoKsApiClient,
  saltoHttpError,
  FAKE_SITE_ID,
};
