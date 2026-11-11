const axios = require("axios");
const BaseAccessApiClient = require("./base-access-api-client");

const REQUEST_TIMEOUT_MS = 10000;

/**
 * The REST API of an Open Locker backend, pinned to `backend-v1.0.0-beta.1`,
 * spoken as the tenant's technical account (role `user`). Open Locker has no
 * access for machines, so the client signs in with e-mail and password
 * (`POST /api/login`), keeps the Sanctum token it gets and signs in again
 * when a call is answered with `401` - once, then the call is repeated once.
 *
 * Open Locker answers its failures with the HTTP status; they reach the
 * caller as the axios error, `response.status` and `response.data` intact.
 */
class OpenLockerApiClient extends BaseAccessApiClient {
  /**
   * @param {string} serverUrl Where the Open Locker backend answers, e.g.
   *   `https://locker.example.org`
   * @param {string} email E-mail address of the technical account
   * @param {string} password Its password, in clear
   */
  constructor(serverUrl, email, password) {
    super(serverUrl || "");
    this.email = email;
    this.password = password;
    this._token = null;
  }

  /**
   * Asks Open Locker to open a compartment:
   * `POST /api/compartments/{uuid}/open`. Open Locker only accepts the
   * request (`202`) and hands the command to the locker; the outcome is
   * polled through {@link OpenLockerApiClient#getOpenRequest}.
   *
   * @param {string} compartmentId The UUID of the compartment
   * @returns {Promise<{command_id: string, state: string}>} Open Locker's
   *   answer
   * @throws {Error} The axios error: `403` with `state: denied` and a
   *   `command_id` for a compartment the account may not open, `403` with
   *   `code: terms_not_accepted` or without a code for a blocked account,
   *   `404` for an unknown compartment
   */
  async openCompartment(compartmentId) {
    return this._request(
      "post",
      `/api/compartments/${encodeURIComponent(compartmentId)}/open`,
    );
  }

  /**
   * The state of an open request:
   * `GET /api/compartments/open-requests/{commandId}`. Only the account that
   * asked for the open sees it.
   *
   * @param {string} commandId The `command_id` the open answered
   * @returns {Promise<Object>} The request, its `state` among `requested`,
   *   `accepted`, `denied`, `sent`, `acknowledged`, `opened`,
   *   `already_open`, `door_jammed`, `failed`
   */
  async getOpenRequest(commandId) {
    return this._request(
      "get",
      `/api/compartments/open-requests/${encodeURIComponent(commandId)}`,
    );
  }

  /**
   * The technical account as Open Locker knows it: `GET /api/user`, with
   * whether it accepted the current terms and verified its address.
   *
   * @returns {Promise<Object>}
   */
  async getUser() {
    return this._request("get", "/api/user");
  }

  /**
   * Whether the credentials sign in to an account that may open
   * compartments. The routes that read pass even for an account that has
   * not accepted the current terms; only an open is refused then. So the
   * test reads the account and says it is blocked where an open would be.
   *
   * @returns {Promise<{success: boolean, message: string, code?: string}>}
   */
  async checkConnection() {
    let user;
    try {
      user = await this.getUser();
    } catch (err) {
      if (classifyOpenLockerError(err) === "invalid_credentials") {
        return {
          success: false,
          code: "invalid_credentials",
          message: "Invalid credentials",
        };
      }
      return BaseAccessApiClient.handleConnectionError(err);
    }

    if (user?.terms_current_accepted === false) {
      return {
        success: false,
        code: "terms_not_accepted",
        message:
          "Account blocked: the technical account has not accepted the current terms of Open Locker",
      };
    }

    if (!user?.email_verified_at) {
      return {
        success: false,
        code: "email_not_verified",
        message:
          "Account blocked: the technical account has not verified its e-mail address",
      };
    }

    return { success: true, message: "Connection successful" };
  }

  /**
   * Runs the connection test of {@link OpenLockerApiClient#checkConnection}
   * with the configuration of the admin form.
   *
   * @param {string} serverUrl Where the Open Locker backend answers
   * @param {string} email E-mail address of the technical account
   * @param {string} password Its password, in clear
   * @returns {Promise<{success: boolean, message: string, code?: string}>}
   *   The result; `code` is `invalid_credentials`, `terms_not_accepted` or
   *   `email_not_verified` where Open Locker refused the account
   */
  static async testConnection(serverUrl, email, password) {
    return new OpenLockerApiClient(
      serverUrl,
      email,
      password,
    ).checkConnection();
  }

  /**
   * @private
   * A call as the technical account: signs in where there is no token yet,
   * and after a `401` signs in again and repeats the call exactly once.
   *
   * @param {"get"|"post"} method HTTP method
   * @param {string} path Path below the server URL, e.g. `/api/user`
   * @param {Object|null} [data=null] JSON body
   * @returns {Promise<Object>} Open Locker's JSON answer
   * @throws {Error} The axios error of the call, or an
   *   {@link OpenLockerLoginError} when the login is refused
   */
  async _request(method, path, data = null) {
    if (!this._token) {
      await this._login();
    }

    try {
      return await this._send(method, path, data, { token: this._token });
    } catch (err) {
      if (err.response?.status !== 401) {
        throw err;
      }
    }

    this._token = null;
    await this._login();
    return this._send(method, path, data, { token: this._token });
  }

  /**
   * @private
   * Signs in as the technical account. A refused login (`422`) is thrown
   * as an {@link OpenLockerLoginError}, so it is never mistaken for a `422`
   * of another route.
   *
   * @returns {Promise<void>} Resolves once the token is kept
   * @throws {OpenLockerLoginError} When Open Locker refuses the credentials
   * @throws {Error} The axios error for every other failure, or one of our
   *   own when the answer carries no token
   */
  async _login() {
    let answer;
    try {
      answer = await this._send("post", "/api/login", {
        email: this.email,
        password: this.password,
      });
    } catch (err) {
      throw err.response?.status === 422 ? new OpenLockerLoginError(err) : err;
    }

    if (!answer?.token) {
      throw new Error("Open Locker answered the login without a token");
    }

    this._token = answer.token;
  }

  /**
   * @private
   * The HTTP transport: one request, its JSON answer. Tests replace this.
   *
   * @param {"get"|"post"} method HTTP method
   * @param {string} path Path below the server URL
   * @param {Object|null} data JSON body, `null` for none
   * @param {Object} [options]
   * @param {string|null} [options.token=null] Bearer token to send
   * @returns {Promise<Object>} The JSON answer
   * @throws {Error} The axios error for a status outside 2xx or no answer
   */
  async _send(method, path, data, { token = null } = {}) {
    const response = await axios.request({
      method,
      url: `${this.baseUrl}${path}`,
      data: data ?? undefined,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  }

  static get capabilities() {
    return ["openCompartment", "getOpenRequest", "getUser"];
  }
}

/**
 * Open Locker refused the credentials of the technical account at the login.
 * Keeps Open Locker's answer, as the axios error had it.
 */
class OpenLockerLoginError extends Error {
  constructor(cause) {
    super(cause.response?.data?.message || cause.message);
    this.name = "OpenLockerLoginError";
    this.response = cause.response;
  }
}

/**
 * What an Open Locker failure means for the platform, read off the HTTP
 * answer:
 * - `invalid_credentials`: the login was refused (`422` at `POST /api/login`)
 * - `unauthorized`: a token was refused even after signing in again (`401`)
 * - `terms_not_accepted`: the account is blocked until it accepts the
 *   current terms (`403`, `code: terms_not_accepted`)
 * - `denied`: the account may not open the compartment (`403`,
 *   `state: denied`)
 * - `forbidden`: any other refusal, e.g. an address not verified (`403`)
 * - `not_found`: the compartment or the request is unknown (`404`)
 * - `unavailable`: everything else - the network, throttling, a server error
 *
 * @param {Error} err The error a client call threw
 * @returns {string}
 */
function classifyOpenLockerError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data || {};

  if (err instanceof OpenLockerLoginError) return "invalid_credentials";
  if (status === 401) return "unauthorized";
  if (status === 403 && data.code === "terms_not_accepted") {
    return "terms_not_accepted";
  }
  if (status === 403 && data.state === "denied") return "denied";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "unavailable";
}

module.exports = {
  OpenLockerApiClient,
  OpenLockerLoginError,
  classifyOpenLockerError,
};
