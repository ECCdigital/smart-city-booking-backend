/**
 * An Open Locker backend without the network: the real `OpenLockerApiClient`
 * with its HTTP transport replaced by an in-memory instance of Open Locker
 * (`backend-v1.0.0-beta.1`). The client's own logic - signing in, keeping
 * the token, signing in again after a `401` and repeating the call once -
 * stays production code.
 *
 * What the fake models of Open Locker, as far as the platform uses it:
 * - `POST /api/login` answers a Sanctum token for the right e-mail and
 *   password, `422` otherwise.
 * - `GET /api/user` answers the account, with whether it accepted the
 *   current terms and verified its e-mail address.
 * - `POST /api/compartments/{uuid}/open` answers `202` with a `command_id`
 *   for a compartment the account may open, `403` with `state: denied` and a
 *   `command_id` for one it may not, `404` for one Open Locker does not
 *   know. An account that has not accepted the current terms gets `403`
 *   with `code: terms_not_accepted`, one without a verified e-mail address
 *   `403` without a code - the order Open Locker checks them in.
 * - `GET /api/compartments/open-requests/{commandId}` answers the state of
 *   the request, `404` for an unknown one, `403` for one of another account.
 *   A request moves on only when the test says so (`advance`), as the
 *   locker would report it.
 * - Any token the instance no longer knows - expired, revoked - is answered
 *   with `401` (`expireTokens`).
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not.
 */

const {
  OpenLockerApiClient,
} = require("../../src/commons/services/access/clients/open-locker-api-client");

const FAKE_SERVER_URL = "https://locker.example.test";
const FAKE_EMAIL = "biletado@example.test";
const FAKE_PASSWORD = "secret";
const COMPARTMENT_ID = "9b2f6c1e-3d4a-4f5b-8c7d-1e2f3a4b5c6d";
const OTHER_COMPARTMENT_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

/** An error the way axios raises one for an HTTP answer outside 2xx. */
function openLockerHttpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

/** A network failure as axios raises it - no response at all. */
function openLockerNetworkError(code = "ECONNREFUSED") {
  return Object.assign(new Error(`connect ${code}`), {
    isAxiosError: true,
    code,
  });
}

class FakeOpenLockerApiClient extends OpenLockerApiClient {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.compartments] Compartments the account may
   *   open, by UUID
   * @param {string[]} [options.foreignCompartments] Compartments Open Locker
   *   knows but the account may not open
   * @param {Object} [options.credentials] What the client signs in with
   *   (`serverUrl`, `email`, `password`)
   */
  constructor({
    compartments = [COMPARTMENT_ID],
    foreignCompartments = [OTHER_COMPARTMENT_ID],
    credentials = {},
  } = {}) {
    super(
      credentials.serverUrl ?? FAKE_SERVER_URL,
      credentials.email ?? FAKE_EMAIL,
      credentials.password ?? FAKE_PASSWORD,
    );
    this.account = {
      email: FAKE_EMAIL,
      password: FAKE_PASSWORD,
      termsAccepted: true,
      emailVerified: true,
    };
    this.compartments = new Set(compartments);
    this.foreignCompartments = new Set(foreignCompartments);
    /** @type {Map<string, Object>} command_id -> open request */
    this.openRequests = new Map();
    /** Tokens the instance knows. */
    this.validTokens = new Set();
    /** Every login the instance answered, successful or not. */
    this.logins = [];
    /** Every request that reached the instance, as `METHOD path`. */
    this.requests = [];
    this._nextId = 1;
  }

  /** Forgets every token, as an expiry or a revocation would. */
  expireTokens() {
    this.validTokens.clear();
  }

  /** Moves an open request on to `state`, as the locker would report it. */
  advance(commandId, state, fields = {}) {
    const request = this.openRequests.get(commandId);
    request.state = state;
    Object.assign(request, fields);
  }

  /** The only open request sent so far. */
  lastOpenRequest() {
    return [...this.openRequests.values()].at(-1);
  }

  async _send(method, path, data, { token = null } = {}) {
    const route = `${method.toUpperCase()} ${path}`;
    this.requests.push(route);

    if (route === "POST /api/login") {
      return this._answerLogin(data);
    }

    if (!this.validTokens.has(token)) {
      throw openLockerHttpError(401, { message: "Unauthenticated" });
    }

    let match;

    if (route === "GET /api/user") {
      return {
        id: 1,
        email: this.account.email,
        email_verified_at: this.account.emailVerified
          ? "2026-10-01T10:00:00.000000Z"
          : null,
        is_admin: false,
        terms_current_version: 2,
        terms_current_accepted: this.account.termsAccepted,
      };
    }

    if (
      method === "post" &&
      (match = path.match(/^\/api\/compartments\/([^/]+)\/open$/))
    ) {
      return this._open(match[1]);
    }

    if (
      method === "get" &&
      (match = path.match(/^\/api\/compartments\/open-requests\/([^/]+)$/))
    ) {
      return this._openStatus(match[1]);
    }

    throw new Error(`fake-open-locker-api-client: unexpected request ${route}`);
  }

  _answerLogin({ email, password } = {}) {
    this.logins.push({ email });
    if (email !== this.account.email || password !== this.account.password) {
      throw openLockerHttpError(422, {
        message: "The provided credentials are incorrect.",
        errors: { email: ["The provided credentials are incorrect."] },
      });
    }

    const token = `${this._nextId++}|fake-token`;
    this.validTokens.add(token);
    return { token, first_name: "Biletado", last_name: null, verified: true };
  }

  _open(compartmentId) {
    if (
      !this.compartments.has(compartmentId) &&
      !this.foreignCompartments.has(compartmentId)
    ) {
      throw openLockerHttpError(404, { message: "Not Found" });
    }

    if (!this.account.termsAccepted) {
      throw openLockerHttpError(403, {
        message: "You must accept the latest terms before continuing.",
        code: "terms_not_accepted",
        terms_current_version: 2,
      });
    }

    if (!this.account.emailVerified) {
      throw openLockerHttpError(403, {
        status: false,
        message: "Please verify your email address before opening compartments",
      });
    }

    const commandId = `cmd-${this._nextId++}`;
    const authorized = this.compartments.has(compartmentId);
    this.openRequests.set(commandId, {
      command_id: commandId,
      compartment_id: compartmentId,
      state: authorized ? "requested" : "denied",
      error_code: null,
      error_message: null,
      denied_reason: authorized ? null : "no_access",
      opened_at: null,
    });

    if (!authorized) {
      throw openLockerHttpError(403, {
        status: false,
        command_id: commandId,
        state: "denied",
        message: "You do not have access to this compartment",
      });
    }

    return {
      status: true,
      command_id: commandId,
      state: "pending",
      message: "Compartment open request accepted",
    };
  }

  _openStatus(commandId) {
    const request = this.openRequests.get(commandId);
    if (!request) {
      throw openLockerHttpError(404, {
        status: false,
        message: "Command not found",
      });
    }

    return { status: true, ...request };
  }
}

/** An Open Locker client whose every request fails with the given error. */
function brokenOpenLockerApiClient(
  error = openLockerHttpError(500, { message: "Server Error" }),
) {
  const client = new FakeOpenLockerApiClient();
  client._send = async () => {
    throw error;
  };
  return client;
}

module.exports = {
  FakeOpenLockerApiClient,
  brokenOpenLockerApiClient,
  openLockerHttpError,
  openLockerNetworkError,
  FAKE_SERVER_URL,
  FAKE_EMAIL,
  FAKE_PASSWORD,
  COMPARTMENT_ID,
  OTHER_COMPARTMENT_ID,
};
