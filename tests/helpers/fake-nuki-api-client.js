/**
 * A Nuki Web API without the web: the real `NukiApiClient` with its HTTP
 * transport replaced by an in-memory smartlock account. Everything above the
 * transport - the state mapping of `getSmartlockState`, the capability
 * derivation - is the production code, so a test through this client
 * exercises the adapter and the client together and fakes only the network.
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not.
 */

const {
  NukiApiClient,
  NUKI_ACTIONS,
} = require("../../src/commons/services/access/clients/nuki-api-client");

/**
 * An error the way axios raises one for an HTTP failure: the adapters and
 * their error mapping read `response.status`, not a message.
 */
function nukiHttpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

/** A network failure as axios raises it - no response at all. */
function nukiNetworkError(code = "ECONNREFUSED") {
  return Object.assign(new Error(`connect ${code}`), {
    isAxiosError: true,
    code,
  });
}

// What a lock action leaves the lock in (`state.state` codes of the Nuki
// Web API): lock -> locked, unlock -> unlocked, unlatch -> unlatched.
const STATE_AFTER_ACTION = Object.freeze({
  [NUKI_ACTIONS.LOCK]: 1,
  [NUKI_ACTIONS.UNLOCK]: 3,
  [NUKI_ACTIONS.UNLATCH]: 5,
  [NUKI_ACTIONS.LOCK_N_GO]: 6,
});

class FakeNukiApiClient extends NukiApiClient {
  /**
   * @param {Object} [options]
   * @param {Object[]} [options.smartlocks] Smartlocks of the account, in the
   *   shape `GET /smartlock` lists them (`smartlockId`, `type`, `state`, ...)
   */
  constructor({ smartlocks = [] } = {}) {
    super("fake-token", "https://nuki.fake");
    this.smartlocks = new Map(
      smartlocks.map((smartlock) => [String(smartlock.smartlockId), smartlock]),
    );
    /** @type {Map<string, Object>} authorization id -> authorization */
    this.authorizations = new Map();
    /** @type {{ smartlockId: string, action: number }[]} every action sent */
    this.actions = [];
    this.callbacks = new Map();
    this._nextId = 1;
  }

  async _request(method, path, data = null) {
    const route = `${method.toUpperCase()} ${path}`;
    let match;

    if (route === "GET /smartlock") {
      return [...this.smartlocks.values()];
    }

    if ((match = path.match(/^\/smartlock\/([^/]+)$/)) && method === "get") {
      return this._smartlock(match[1]);
    }

    if (
      (match = path.match(/^\/smartlock\/([^/]+)\/action$/)) &&
      method === "post"
    ) {
      const smartlock = this._smartlock(match[1]);
      this.actions.push({ smartlockId: match[1], action: data.action });
      smartlock.state = {
        ...(smartlock.state || {}),
        state: STATE_AFTER_ACTION[data.action] ?? smartlock.state?.state,
      };
      // Nuki answers an action with 204 and no body.
      return "";
    }

    if (
      (match = path.match(/^\/smartlock\/([^/]+)\/auth$/)) &&
      method === "put"
    ) {
      this._smartlock(match[1]);
      const id = `auth-${this._nextId++}`;
      const authorization = { id, smartlockId: Number(match[1]), ...data };
      this.authorizations.set(id, authorization);
      return authorization;
    }

    if (
      (match = path.match(/^\/smartlock\/([^/]+)\/auth\/([^/]+)$/)) &&
      method === "delete"
    ) {
      if (!this.authorizations.delete(match[2])) {
        throw nukiHttpError(404, { detailMessage: "authorization not found" });
      }
      return "";
    }

    if (route === "POST /callback/add") {
      const id = this._nextId++;
      this.callbacks.set(id, { id, url: data.url });
      return { id, url: data.url };
    }

    if (route === "POST /callback/remove") {
      this.callbacks.delete(data.id);
      return "";
    }

    throw new Error(`fake-nuki-api-client: unexpected request ${route}`);
  }

  _smartlock(smartlockId) {
    const smartlock = this.smartlocks.get(String(smartlockId));
    if (!smartlock) {
      throw nukiHttpError(404, { detailMessage: "smartlock not found" });
    }
    return smartlock;
  }
}

/** A Nuki client whose every request fails with the given error. */
class BrokenNukiApiClient extends NukiApiClient {
  constructor(error = nukiHttpError(500)) {
    super("fake-token", "https://nuki.fake");
    this.error = error;
  }

  async _request() {
    throw this.error;
  }
}

module.exports = {
  FakeNukiApiClient,
  BrokenNukiApiClient,
  nukiHttpError,
  nukiNetworkError,
};
