const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createTenantClientCache } = require("../clients/tenant-client-cache");
const {
  classifyOpenLockerError,
} = require("../clients/open-locker-api-client");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");
const { NotFoundError } = require("../../../../errors/BaseError");
const { DOMAIN } = require("../../authorization/reach");

require("../clients");

const PROVIDER_ID = "open-locker";
const APP_TYPE = "access";

// The client of each tenant, kept while server, account and password stay
// the same, so its token is reused instead of signing in on every open and
// every poll - Open Locker throttles the login to six attempts a minute.
const clients = createTenantClientCache(PROVIDER_ID, (app) => [
  app.serverUrl,
  app.email,
  app.password,
]);

// Open Locker's states before the locker reported an end: the storefront
// polls on.
const STATES_IN_PROGRESS = ["requested", "accepted", "sent", "acknowledged"];
// The two ends that confirm the open: the door was seen open, or stood open
// already.
const STATES_CONFIRMED = ["opened", "already_open"];
// The ends that are failures, each as the error the guest's poll answers.
const STATES_FAILED = {
  door_jammed: {
    errorCode: "door_jammed",
    errorMessage: "Open Locker reports the compartment door as jammed",
  },
  failed: {
    errorCode: "open_failed",
    errorMessage: "Open Locker could not open the compartment",
  },
  denied: {
    errorCode: "configuration",
    errorMessage:
      "Open Locker denied the open - check the technical account's access to the compartment",
  },
};

/**
 * Open Locker compartments: each compartment is a door in mode `remote`, its
 * `externalId` the UUID of the compartment, bound to one bookable. The
 * tenant's technical account (role `user`) holds a standing permission on
 * the tenant's compartments; whether a booking may open one right now is
 * Biletado's decision alone, so Open Locker learns of no booking, and a
 * cancellation or a change of a booking is nothing to tell it - the
 * provider declares no grant, no revoke and no hold.
 *
 * An open hands the command to the locker and answers `pending` with the
 * `command_id` to poll; Open Locker confirms with `opened` or
 * `already_open`. What the locker does not report within the storefront's
 * polling stays unconfirmed (`open_unconfirmed` there).
 */
class OpenLockerAccessProvider extends AccessProvider {
  /**
   * The tenant's Open Locker client, kept per tenant so its token is reused.
   * @private
   * @throws {NotFoundError} `open_locker_application_not_found` when the
   *   tenant has no active Open Locker application
   */
  async _getClient(tenant) {
    if (this._client) {
      return this._client;
    }

    const tenantData = await TenantManager.getTenant(tenant, DOMAIN);
    const rawApp = this._findActiveApplication(tenantData, PROVIDER_ID, [
      APP_TYPE,
    ]);

    if (!rawApp) {
      throw new NotFoundError("open_locker_application_not_found", { tenant });
    }

    return clients.clientFor(tenant, rawApp);
  }

  /**
   * Asks Open Locker to open the compartment. The answer is always
   * `pending`, with Open Locker's `command_id` as the process to poll - the
   * audit stores it with the open, so the end state can be looked up in
   * Open Locker.
   *
   * @param {Object} accessPoint The compartment, its `externalId` the UUID
   * @param {Object} bookingContext The booking it is opened for
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   * @throws {AccessOpenError} `configuration` for everything the tenant's
   *   setup is to blame for - no application, wrong credentials, a blocked
   *   account, a compartment the account may not open or Open Locker does
   *   not know; `temporary` for the network, throttling and server errors
   */
  async open(accessPoint, bookingContext) {
    const client = await this._getClientForOpen(bookingContext.tenant);
    const compartmentId = String(accessPoint.externalId);

    let answer;
    try {
      answer = await client.openCompartment(compartmentId);
    } catch (err) {
      throw this._mapOpenError(err, compartmentId);
    }

    if (!answer?.command_id) {
      throw AccessOpenError.temporary(
        `Open Locker answered the open of compartment '${compartmentId}' without a command_id`,
      );
    }

    return { state: "pending", openProcessId: String(answer.command_id) };
  }

  /**
   * How far the open request has come, read once - the storefront polls.
   * Open Locker's state maps onto the progress as follows: before an end,
   * not confirmed and no error; `opened` and `already_open` confirmed;
   * `door_jammed`, `failed` and `denied` an error each. A poll that fails,
   * or a state this adapter does not know, is answered with
   * `confirmed: null` and the reason, never thrown.
   *
   * @param {Object} accessPoint The compartment that was opened; carries
   *   `tenantId`
   * @param {string} openProcessId The `command_id` the open answered with
   * @returns {Promise<import("./access-provider").OpenProgress>}
   */
  async getOpenProgress(accessPoint, openProcessId) {
    let request;
    try {
      const client = await this._getClient(accessPoint.tenantId);
      request = await client.getOpenRequest(openProcessId);
    } catch (err) {
      return unreadProgress(
        `Open Locker could not report open request '${openProcessId}': ${describeError(err)}`,
      );
    }

    const state = request?.state;

    if (STATES_IN_PROGRESS.includes(state)) {
      return {
        confirmed: false,
        confirmedAt: null,
        errorCode: null,
        errorMessage: null,
      };
    }

    if (STATES_CONFIRMED.includes(state)) {
      return {
        confirmed: true,
        confirmedAt: request.opened_at || null,
        errorCode: null,
        errorMessage: null,
      };
    }

    if (STATES_FAILED[state]) {
      const { errorCode, errorMessage } = STATES_FAILED[state];
      const detail = request.error_message || request.denied_reason;
      return {
        confirmed: false,
        confirmedAt: null,
        errorCode,
        errorMessage: detail ? `${errorMessage}: ${detail}` : errorMessage,
      };
    }

    return unreadProgress(
      `Open Locker reports open request '${openProcessId}' in the unknown state '${state}'`,
    );
  }

  /**
   * @private
   * A failed open request as the failure class the guest may see. A
   * denial names Open Locker's `command_id`, so the audit, which stores the
   * message, keeps it for the lookup in Open Locker.
   *
   * @param {Error} err What the open request threw
   * @param {string} compartmentId The UUID of the compartment
   * @returns {AccessOpenError} `configuration` for what the tenant's setup is
   *   to blame for, `temporary` for everything else
   */
  _mapOpenError(err, compartmentId) {
    const detail = describeError(err);
    const data = err?.response?.data || {};

    switch (classifyOpenLockerError(err)) {
      case "invalid_credentials":
        return AccessOpenError.configuration(
          `Open Locker refused the credentials of the technical account: ${detail}`,
        );
      case "unauthorized":
        return AccessOpenError.configuration(
          `Open Locker refused the token of the technical account even after signing in again (401): ${detail}`,
        );
      case "terms_not_accepted":
        return AccessOpenError.configuration(
          `Open Locker blocks the technical account until it accepts the current terms: ${detail}`,
        );
      case "denied":
        return AccessOpenError.configuration(
          `Open Locker denied the open of compartment '${compartmentId}' (command_id ${data.command_id}) - check the technical account's access: ${detail}`,
        );
      case "forbidden":
        return AccessOpenError.configuration(
          `Open Locker blocked the technical account from opening compartment '${compartmentId}': ${detail}`,
        );
      case "not_found":
        return AccessOpenError.configuration(
          `Open Locker does not know compartment '${compartmentId}': ${detail}`,
        );
      default:
        return AccessOpenError.temporary(
          `Open Locker open of compartment '${compartmentId}' failed: ${detail}`,
        );
    }
  }

  /** Opened without a QR scan, unless the access point configures one. */
  static get requiresScanByDefault() {
    return false;
  }

  static get capabilities() {
    // No getStatus: the door state is not shown, the end state of an open
    // is enough. No grant, revoke or hold: Open Locker knows no bookings,
    // Biletado alone decides whether a booking may open.
    return ["open", "getOpenProgress"];
  }
}

/** The progress of a poll that could not be read. */
function unreadProgress(errorMessage) {
  return {
    confirmed: null,
    confirmedAt: null,
    errorCode: null,
    errorMessage,
  };
}

/** Open Locker's own message where it answered, the error's otherwise. */
function describeError(err) {
  const status = err?.response?.status;
  const message = err?.response?.data?.message || err?.message || String(err);
  return status ? `${status} ${message}` : message;
}

module.exports = OpenLockerAccessProvider;
