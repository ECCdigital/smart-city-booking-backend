const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createTenantClientCache } = require("../clients/tenant-client-cache");
const {
  classifyOpenLockerError,
} = require("../clients/open-locker-api-client");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");
const { NotFoundError } = require("../../../../errors/BaseError");
const { ValidationError } = require("../../../../errors/ValidationError");
const { DOMAIN } = require("../../authorization/reach");
const {
  AccessCapability,
  AccessPointMode,
  AccessPointType,
} = require("../../../entities/access/access-point");

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
 * Open Locker compartments, in mode `remote`: the only access point is the
 * locker system, a `locker` that carries its own compartments, picked from
 * the listing (`resolveCompartments`), and the platform assigns them - one
 * with a single compartment included (tickets#1162). The
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
   * Asks Open Locker to open the compartment the platform assigned at a
   * locker system (`openCompartment` with its UUID). The answer is always
   * `pending`, with Open Locker's `command_id` as the process to poll - the
   * audit stores it with the open, so the end state can be looked up in
   * Open Locker. Anything else - a door stored before tickets#1162, a
   * locker system without an assigned compartment - opens nothing.
   *
   * @param {Object} accessPoint The assigned compartment as the service
   *   hands it: the locker system's row, its `externalId` the UUID of the
   *   compartment
   * @param {Object} bookingContext The booking it is opened for
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   * @throws {AccessOpenError} `configuration` for everything the tenant's
   *   setup is to blame for - no application, wrong credentials, a blocked
   *   account, a compartment the account may not open or Open Locker does
   *   not know, an access point that is no compartment of a locker system;
   *   `temporary` for the network, throttling and server errors
   */
  async open(accessPoint, bookingContext) {
    if (
      accessPoint.type !== AccessPointType.LOCKER ||
      !accessPoint.externalId
    ) {
      throw AccessOpenError.configuration(
        `Open Locker opens only the assigned compartment of a locker system, not access point '${accessPoint.id}' of type '${accessPoint.type}'`,
      );
    }

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

  /**
   * The compartments the tenant's technical account holds a permission on -
   * on an instance several tenants share, only the tenant's own, because
   * each account is permitted on its own compartments alone. Each is a door
   * opened remotely, named by its locker bank and number, e.g.
   * „Labor Fachbank 1 · Fach 2“; its locker bank is the location.
   *
   * @param {string} tenant Tenant to list for
   * @returns {Promise<import("./access-provider").ListedAccessPoint[]>}
   * @throws {NotFoundError} `open_locker_application_not_found` when the
   *   tenant has no active Open Locker application
   * @throws {Error} The client's error when Open Locker does not answer
   */
  async listAccessPoints(tenant) {
    const client = await this._getClient(tenant);
    const answer = await client.getAccessibleCompartments();

    return (answer?.locker_banks || []).flatMap((lockerBank) =>
      (lockerBank.compartments || []).map((compartment) =>
        listedCompartment(lockerBank, compartment),
      ),
    );
  }

  /**
   * Refuses everything but a Schließfachanlage, before the listing is
   * fetched: Open Locker knows only the Anlage, one with a single Fach
   * included (tickets#1162). A `door` - the former fixed Fach - is refused
   * at `type`, whether it comes from the API or an old client and whether
   * the tenant's application is active or not.
   *
   * @param {Object} accessPoint The access point as it would be stored
   * @returns {void}
   * @throws {ValidationError} `open_locker_locker_only` at `type`, or what
   *   an Anlage is refused for (`validateLockerSystem`)
   */
  validateAccessPointWithoutListing(accessPoint) {
    if (accessPoint.type !== AccessPointType.LOCKER) {
      throw new ValidationError([
        { field: "type", code: "open_locker_locker_only", params: {} },
      ]);
    }

    validateLockerSystem(accessPoint);
  }

  /**
   * The Fächer of a Schließfachanlage as stored: each with its
   * Schließfachschrank (`id`, `name`) and number from the listing of the
   * tenant's technical account. A Fach the account holds no permission on
   * is refused at that Fach (`compartment_not_accessible`), so no Fach is
   * set up that never opens.
   *
   * @param {Object[]} compartments The requested Fächer in the stored shape
   * @param {import("./access-provider").ListedAccessPoint[]}
   *   listedAccessPoints The listing of the tenant's technical account
   * @returns {Object[]} The Fächer as they are stored
   * @throws {ValidationError} `compartment_not_accessible` at
   *   `config.compartments.<i>`
   */
  resolveCompartments(compartments, listedAccessPoints) {
    const listed = new Map(
      (listedAccessPoints || []).map((entry) => [String(entry.id), entry]),
    );
    const errors = [];

    const resolved = compartments.map((compartment, index) => {
      const entry = listed.get(compartment.id);

      if (!entry) {
        errors.push({
          field: `config.compartments.${index}`,
          code: "compartment_not_accessible",
          params: { compartmentId: compartment.id },
        });
        return compartment;
      }

      return {
        id: compartment.id,
        number: entry.metadata.number,
        lockerBank: {
          id: entry.metadata.lockerBank.id,
          name: entry.metadata.lockerBank.name,
        },
        outOfService: compartment.outOfService,
      };
    });

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    return resolved;
  }

  /** Opened without a QR scan, unless the access point configures one. */
  static get requiresScanByDefault() {
    return false;
  }

  static get capabilities() {
    // No getStatus: the door state is not shown, the end state of an open
    // is enough. No grant, revoke or hold: Open Locker knows no bookings,
    // Biletado alone decides whether a booking may open.
    return [
      "open",
      "getOpenProgress",
      "listAccessPoints",
      "validateAccessPointWithoutListing",
      "resolveCompartments",
    ];
  }
}

/**
 * A Schließfachanlage of Open Locker, before the listing: it opens remotely
 * and carries its own list of Fächer (tickets#1037), so it needs no UUID of
 * its own.
 *
 * @throws {ValidationError} `unsupported_mode` at `mode`, `required` at
 *   `config.compartments`
 */
function validateLockerSystem(accessPoint) {
  const errors = [];

  if (accessPoint.mode !== AccessPointMode.REMOTE) {
    errors.push({
      field: "mode",
      code: "unsupported_mode",
      params: {
        mode: accessPoint.mode,
        supportedModes: [AccessPointMode.REMOTE],
      },
    });
  }

  if (!Array.isArray(accessPoint.config?.compartments)) {
    errors.push({ field: "config.compartments", code: "required" });
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/** A compartment of Open Locker's listing as the shared listed shape. */
function listedCompartment(lockerBank, compartment) {
  const id = String(compartment.id);

  return {
    id,
    type: "door",
    provider: PROVIDER_ID,
    externalId: id,
    locationId: String(lockerBank.id),
    label: `${lockerBank.name} · Fach ${compartment.number}`,
    capabilities: [AccessCapability.REMOTE],
    supportedModes: [AccessPointMode.REMOTE],
    metadata: {
      ...compartment,
      lockerBank: {
        id: String(lockerBank.id),
        name: lockerBank.name,
        locationDescription: lockerBank.location_description ?? null,
      },
    },
  };
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
