/**
 * An Open Locker backend without the network: the real `OpenLockerApiClient`
 * with its HTTP transport replaced by an in-memory instance of Open Locker
 * (`backend-v1.0.0-beta.1`). The client's own logic - signing in, keeping
 * the token, signing in again after a `401` and repeating the call once -
 * stays production code.
 *
 * One instance serves several tenants, each through a technical account
 * of its own (role `user`), and every account holds a permission on its
 * tenant's compartments only - the setup of one instance for the whole
 * KielRegion. The client signs in as the first account; the others are the
 * neighbours whose compartments it must never see.
 *
 * What the fake models of Open Locker, as far as the platform uses it:
 * - `POST /api/login` answers a Sanctum token for an account's e-mail and
 *   password, `422` otherwise. The token stands for that account.
 * - `GET /api/user` answers the account, with whether it accepted the
 *   current terms and verified its e-mail address.
 * - `GET /api/compartments/accessible` answers the locker banks with the
 *   compartments the account holds a permission on, ordered by name and
 *   number; a locker bank without one is left out. Like every reading
 *   route it passes for an account blocked for terms not accepted.
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
const NEIGHBOUR_EMAIL = "nachbarort@example.test";
const NEIGHBOUR_PASSWORD = "nachbar-secret";
const LOCKER_BANK_ID = "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8";
const SECOND_LOCKER_BANK_ID = "5f6a7b8c-9d0e-4f1a-b2c3-d4e5f6a7b8c9";
/** The tenant's compartment: „Labor Fachbank 1“, number 1. */
const COMPARTMENT_ID = "9b2f6c1e-3d4a-4f5b-8c7d-1e2f3a4b5c6d";
/** The neighbour's compartment in the same locker bank, number 2. */
const OTHER_COMPARTMENT_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
/** The tenant's compartment in a second locker bank, number 3. */
const SECOND_COMPARTMENT_ID = "1d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a";

/**
 * The locker banks of the instance and every compartment they hold, as
 * Open Locker keeps them - whoever may open them.
 */
function defaultLockerBanks() {
  return [
    {
      id: LOCKER_BANK_ID,
      name: "Labor Fachbank 1",
      location_description: "Labor, Regal links",
      compartments: [
        { id: COMPARTMENT_ID, number: 1 },
        { id: OTHER_COMPARTMENT_ID, number: 2 },
      ],
    },
    {
      id: SECOND_LOCKER_BANK_ID,
      name: "Quartiersschrank Hafen",
      location_description: null,
      compartments: [{ id: SECOND_COMPARTMENT_ID, number: 3 }],
    },
  ];
}

/**
 * The technical accounts of the instance, the tenant's first: each with
 * the compartments it holds a permission on.
 */
function defaultAccounts() {
  return [
    {
      email: FAKE_EMAIL,
      password: FAKE_PASSWORD,
      compartments: [COMPARTMENT_ID, SECOND_COMPARTMENT_ID],
    },
    {
      email: NEIGHBOUR_EMAIL,
      password: NEIGHBOUR_PASSWORD,
      compartments: [OTHER_COMPARTMENT_ID],
    },
  ];
}

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
   * @param {Object[]} [options.lockerBanks] The locker banks of the
   *   instance, each with `id`, `name`, `location_description` and its
   *   `compartments` (`id`, `number`)
   * @param {Object[]} [options.accounts] The technical accounts, each with
   *   `email`, `password` and the `compartments` it holds a permission on,
   *   by UUID; the client signs in as the first
   * @param {Object} [options.credentials] What the client signs in with
   *   (`serverUrl`, `email`, `password`), the first account's by default
   */
  constructor({
    lockerBanks = defaultLockerBanks(),
    accounts = defaultAccounts(),
    credentials = {},
  } = {}) {
    super(
      credentials.serverUrl ?? FAKE_SERVER_URL,
      credentials.email ?? accounts[0].email,
      credentials.password ?? accounts[0].password,
    );
    this.lockerBanks = lockerBanks;
    /** @type {Map<string, Object>} e-mail -> account */
    this.accounts = new Map(
      accounts.map((account) => [
        account.email,
        {
          email: account.email,
          password: account.password,
          termsAccepted: true,
          emailVerified: true,
          permissions: new Set(account.compartments),
        },
      ]),
    );
    /** The tenant's account, the one the client signs in as. */
    this.account = this.accounts.get(accounts[0].email);
    /** @type {Map<string, Object>} command_id -> open request */
    this.openRequests = new Map();
    /** @type {Map<string, string>} token -> e-mail of its account */
    this.tokens = new Map();
    /** Every login the instance answered, successful or not. */
    this.logins = [];
    /** Every request that reached the instance, as `METHOD path`. */
    this.requests = [];
    this._nextId = 1;
  }

  /** Takes the account's permission on a compartment away. */
  revokePermission(compartmentId, email = this.account.email) {
    this.accounts.get(email).permissions.delete(compartmentId);
  }

  /** Forgets every token, as an expiry or a revocation would. */
  expireTokens() {
    this.tokens.clear();
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

    const account = this.accounts.get(this.tokens.get(token));
    if (!account) {
      throw openLockerHttpError(401, { message: "Unauthenticated" });
    }

    let match;

    if (route === "GET /api/user") {
      return {
        id: 1,
        email: account.email,
        email_verified_at: account.emailVerified
          ? "2026-10-01T10:00:00.000000Z"
          : null,
        is_admin: false,
        terms_current_version: 2,
        terms_current_accepted: account.termsAccepted,
      };
    }

    if (route === "GET /api/compartments/accessible") {
      return this._accessible(account);
    }

    if (
      method === "post" &&
      (match = path.match(/^\/api\/compartments\/([^/]+)\/open$/))
    ) {
      return this._open(account, match[1]);
    }

    if (
      method === "get" &&
      (match = path.match(/^\/api\/compartments\/open-requests\/([^/]+)$/))
    ) {
      return this._openStatus(account, match[1]);
    }

    throw new Error(`fake-open-locker-api-client: unexpected request ${route}`);
  }

  _answerLogin({ email, password } = {}) {
    this.logins.push({ email });
    const account = this.accounts.get(email);
    if (!account || password !== account.password) {
      throw openLockerHttpError(422, {
        message: "The provided credentials are incorrect.",
        errors: { email: ["The provided credentials are incorrect."] },
      });
    }

    const token = `${this._nextId++}|fake-token`;
    this.tokens.set(token, email);
    return { token, first_name: "Biletado", last_name: null, verified: true };
  }

  _accessible(account) {
    const lockerBanks = [...this.lockerBanks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((lockerBank) => ({
        id: lockerBank.id,
        name: lockerBank.name,
        location_description: lockerBank.location_description,
        last_compartment_state_change_at: null,
        compartments: lockerBank.compartments
          .filter((compartment) => account.permissions.has(compartment.id))
          .sort((a, b) => a.number - b.number)
          .map((compartment) => ({
            id: compartment.id,
            number: compartment.number,
            door_state: "closed",
            door_state_changed_at: null,
            content_note: null,
            content_note_updated_at: null,
            content_note_updated_by_user_id: null,
          })),
      }))
      .filter((lockerBank) => lockerBank.compartments.length > 0);

    return { status: true, locker_banks: lockerBanks };
  }

  _knows(compartmentId) {
    return this.lockerBanks.some((lockerBank) =>
      lockerBank.compartments.some(
        (compartment) => compartment.id === compartmentId,
      ),
    );
  }

  _open(account, compartmentId) {
    if (!this._knows(compartmentId)) {
      throw openLockerHttpError(404, { message: "Not Found" });
    }

    if (!account.termsAccepted) {
      throw openLockerHttpError(403, {
        message: "You must accept the latest terms before continuing.",
        code: "terms_not_accepted",
        terms_current_version: 2,
      });
    }

    if (!account.emailVerified) {
      throw openLockerHttpError(403, {
        status: false,
        message: "Please verify your email address before opening compartments",
      });
    }

    const commandId = `cmd-${this._nextId++}`;
    const authorized = account.permissions.has(compartmentId);
    this.openRequests.set(commandId, {
      actor: account.email,
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

  _openStatus(account, commandId) {
    const request = this.openRequests.get(commandId);
    if (!request) {
      throw openLockerHttpError(404, {
        status: false,
        message: "Command not found",
      });
    }

    const { actor, ...state } = request;
    if (actor !== account.email) {
      throw openLockerHttpError(403, {
        status: false,
        message: "You are not allowed to view this command",
      });
    }

    return { status: true, ...state };
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
  NEIGHBOUR_EMAIL,
  NEIGHBOUR_PASSWORD,
  LOCKER_BANK_ID,
  SECOND_LOCKER_BANK_ID,
  COMPARTMENT_ID,
  OTHER_COMPARTMENT_ID,
  SECOND_COMPARTMENT_ID,
};
