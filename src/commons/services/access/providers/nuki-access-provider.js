const crypto = require("crypto");
const bunyan = require("bunyan");
const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../clients/access-client-registry");
const {
  NukiApiClient,
  NUKI_ACTIONS,
  NUKI_AUTH_TYPES,
  NUKI_OPEN_ACTIONS,
  NUKI_OPEN_ACTION_NUMBERS,
} = require("../clients/nuki-api-client");
const {
  deriveSupportedModes,
} = require("../../../entities/access/access-point");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");
const { LockBusyError } = require("../../../../errors/LockBusyError");
const { NotFoundError } = require("../../../../errors/BaseError");

require("../clients");

const APP_TYPE = "access";
const PROVIDER_ID = "nuki";

// Nuki creates an authorization asynchronously: the create answers 204 and
// the authorization turns up in the listing a moment later. This is how
// long a grant waits for it.
const AUTHORIZATION_LOOKUP = Object.freeze({ attempts: 5, delayMs: 1000 });

// The Web API caps an authorization name at 32 characters.
const AUTHORIZATION_NAME_MAX_LENGTH = 32;

// Keypad codes are six digits from 1 to 9 - no zero - and may not start
// with 12.
const KEYPAD_DIGITS = "123456789";
const KEYPAD_CODE = /^(?!12)[1-9]{6}$/;

// Where the Öffnungsart that was sent came from: the access point says it,
// the device type decides it, or the device could not be read and the open
// fell back to unlocking.
const OPEN_ACTION_ORIGINS = Object.freeze({
  CONFIGURED: "configured",
  DEVICE_TYPE: "device_type",
  FALLBACK: "fallback",
});

// The Öffnungsart a lock nobody could read is opened with: unlocking is the
// one action every Nuki device takes, so the door opens the way it always
// did instead of not opening at all.
const FALLBACK_OPEN_ACTION = NUKI_OPEN_ACTIONS.UNLOCK;

/**
 * The Öffnungsart an open carries out: the word the platform records, where
 * the choice came from, and the action number that goes to the lock.
 *
 * @typedef {Object} OpenActionChoice
 * @property {"unlock"|"unlatch"|"lock_n_go"|"lock_n_go_unlatch"} openAction
 * @property {"configured"|"device_type"|"fallback"} openActionOrigin
 * @property {number} nukiAction
 */

/**
 * An Öffnungsart with the Nuki action that carries it out.
 *
 * @param {string} openAction The Öffnungsart to send
 * @param {string} openActionOrigin Where the choice came from
 * @returns {OpenActionChoice}
 */
function openActionChoice(openAction, openActionOrigin) {
  return {
    openAction,
    openActionOrigin,
    nukiAction: NUKI_OPEN_ACTION_NUMBERS[openAction],
  };
}

const logger = bunyan.createLogger({
  name: "nuki-access-provider.js",
  level: process.env.LOG_LEVEL,
});

class NukiAccessProvider extends AccessProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] As of {@link AccessProvider}
   * @param {Object} [options.authorizationLookup] How often and how patiently
   *   a grant asks the listing for the authorization Nuki creates
   *   asynchronously; tests shorten the wait
   */
  constructor({ client = null, authorizationLookup = {} } = {}) {
    super({ client });
    this._authorizationLookup = {
      ...AUTHORIZATION_LOOKUP,
      ...authorizationLookup,
    };
  }

  /**
   * @private
   * @param {string} tenant Tenant the client acts for
   * @returns {Promise<Object>} The tenant's Nuki API client
   * @throws {NotFoundError} `nuki_application_not_found` when the tenant
   *   has no active Nuki application
   */
  async _getClient(tenant) {
    if (this._client) {
      return this._client;
    }

    const tenantData = await TenantManager.getTenant(tenant);
    const rawApp = tenantData?.applications?.find(
      (a) => a.type === APP_TYPE && a.id === PROVIDER_ID && a.active,
    );

    if (!rawApp) {
      throw new NotFoundError("nuki_application_not_found", { tenant });
    }

    return createClient(rawApp);
  }

  /**
   * Opens the access point with its Öffnungsart: the access point names one
   * in `config.openAction`, and where it does not - a missing key reads as
   * `auto` - the device type decides, as it always did. What the person at
   * the door gets out of it is the difference between "the door is open" and
   * "it is unlocked, now push".
   *
   * The choice is the access point's, never the caller's: a client that could
   * name the action could also name the weaker one. A configured Öffnungsart
   * is carried out as it stands - no second attempt with unlock, and no live
   * lookup of the device either, which saves a Nuki request per open. Only
   * `auto` falls back, and only to unlocking, so nobody waits out a failed
   * lookup in front of the door.
   *
   * Nuki's 204 means the action was received, not that it was carried out:
   * the lock turns afterwards, and there is no process to poll for it. The
   * outcome is therefore always `opened` - "command accepted" - and whether
   * the door did open is what the client's follow-up status reads (its
   * confirmation burst) learn from the lock. It names the Öffnungsart that
   * went out, where it came from and the raw Nuki action, for the service to
   * record.
   *
   * @param {Object} accessPoint The access point to open
   * @param {Object} bookingContext The booking the door is opened for
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   * @throws {AccessOpenError} `configuration` when `config.openAction` is
   *   not an Öffnungsart this provider knows
   */
  async open(accessPoint, bookingContext) {
    const client = await this._getClientForOpen(bookingContext.tenant);
    const choice = await this._chooseOpenAction(client, accessPoint);

    // Outcome and failure both name the Öffnungsart that went out - it is
    // worth recording either way, and only this method knows it.
    try {
      const outcome = await this._executeOpenAction(
        client,
        accessPoint,
        choice.nukiAction,
        "open",
      );

      return { ...outcome, ...choice };
    } catch (err) {
      throw Object.assign(err, choice);
    }
  }

  /**
   * @private
   * The Öffnungsart this open carries out. An access point that names one is
   * taken at its word; `auto` and a missing key ask the lock what it is.
   *
   * @param {Object} client The tenant's Nuki API client
   * @param {Object} accessPoint The access point being opened
   * @returns {Promise<OpenActionChoice>}
   * @throws {AccessOpenError} `configuration` for a value the Öffnungsart
   *   vocabulary does not have: reading it as `auto` would open the door
   *   another way than the administration set, without anybody noticing
   */
  async _chooseOpenAction(client, accessPoint) {
    const configured =
      accessPoint?.config?.openAction ?? NUKI_OPEN_ACTIONS.AUTO;

    if (configured === NUKI_OPEN_ACTIONS.AUTO) {
      return this._openActionForDevice(client, accessPoint);
    }

    // An own key, not one off the prototype chain: `constructor` and
    // `toString` are words a hand-written config can carry, and a plain
    // lookup would answer them with a function to send to the lock.
    if (
      !Object.prototype.hasOwnProperty.call(
        NUKI_OPEN_ACTION_NUMBERS,
        configured,
      )
    ) {
      throw AccessOpenError.configuration(
        `'${configured}' is not an open action of access point '${accessPoint.id}': config.openAction takes ${Object.keys(
          NUKI_OPEN_ACTION_NUMBERS,
        ).join(", ")} or auto`,
      );
    }

    return openActionChoice(configured, OPEN_ACTION_ORIGINS.CONFIGURED);
  }

  /**
   * @private
   * What `auto` means at this lock, read from the smartlock itself: a lock on
   * a door and an opener open the door, a box unlocks.
   *
   * A lookup that fails, and a device type Nuki does not name, are answered
   * with unlocking: the door then opens the way it always did instead of not
   * opening at all.
   *
   * @param {Object} client The tenant's Nuki API client
   * @param {Object} accessPoint The access point being opened
   * @returns {Promise<OpenActionChoice>}
   */
  async _openActionForDevice(client, accessPoint) {
    let openAction = null;

    try {
      const smartlock = await client.getSmartlock(accessPoint.externalId);
      openAction = NukiApiClient.autoOpenActionForSmartlock(smartlock);
    } catch (err) {
      logger.warn(
        `Could not read smartlock ${accessPoint.externalId} to decide on its open action, unlocking instead: ${err.message}`,
      );
    }

    return openAction
      ? openActionChoice(openAction, OPEN_ACTION_ORIGINS.DEVICE_TYPE)
      : openActionChoice(FALLBACK_OPEN_ACTION, OPEN_ACTION_ORIGINS.FALLBACK);
  }

  async close(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);

    try {
      await client.executeAction(accessPoint.externalId, NUKI_ACTIONS.LOCK);
    } catch (err) {
      throw this._mapActionError(err, accessPoint, "close");
    }
  }

  /**
   * Pulls the latch so the door physically opens, instead of only releasing
   * the lock (unlock). Requires a Nuki actor that is mounted on a door with
   * a latch (i.e. not an Opener/Box).
   *
   * @param {Object} accessPoint The access point to unlatch
   * @param {Object} bookingContext The booking the door is unlatched for
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   */
  async unlatch(accessPoint, bookingContext) {
    const client = await this._getClientForOpen(bookingContext.tenant);

    return this._executeOpenAction(
      client,
      accessPoint,
      NUKI_ACTIONS.UNLATCH,
      "unlatch",
    );
  }

  /**
   * @private
   * Sends the action that opens the door and turns whatever Nuki answers
   * into the failure class the guest may see: a smartlock Nuki does not
   * know or a token it refuses are configuration, everything else - the
   * lock offline, Nuki down, the network - is temporary.
   *
   * @param {Object} client The tenant's Nuki API client
   * @param {Object} accessPoint The access point being opened
   * @param {number} action The Nuki action to send
   * @param {"open"|"unlatch"} command The command of the access API this
   *   action carries out, named in the error when the lock is busy
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   * @throws {LockBusyError|AccessOpenError}
   */
  async _executeOpenAction(client, accessPoint, action, command) {
    try {
      await client.executeAction(accessPoint.externalId, action);
    } catch (err) {
      throw this._mapActionError(err, accessPoint, command);
    }

    return { state: "opened", openProcessId: null };
  }

  /**
   * @private
   * The one thing every action shares: a Nuki 423 means the smartlock is
   * still busy with its previous action, and that is Lock Busy whichever
   * way the door was asked to turn. Everything else stays what it was per
   * action - an open failure is told by its class, a close failure is
   * rethrown as Nuki reported it.
   *
   * @param {Error} err What the Nuki API client threw
   * @param {Object} accessPoint The access point the action was sent to
   * @param {"open"|"unlatch"|"close"} command The platform command that
   *   failed (not the Nuki numeric action)
   * @returns {Error} The error to throw in its place
   */
  _mapActionError(err, accessPoint, command) {
    if (err?.response?.status === 423) {
      return new LockBusyError(
        PROVIDER_ID,
        command,
        `Nuki reports smartlock '${accessPoint.externalId}' busy with its previous action`,
      );
    }

    return command === "close" ? err : this._mapOpenError(err, accessPoint);
  }

  /** @private */
  _mapOpenError(err, accessPoint) {
    const status = err?.response?.status;
    const detail = err.message || String(err);

    if (status === 404) {
      return AccessOpenError.configuration(
        `Nuki does not know smartlock '${accessPoint.externalId}': ${detail}`,
      );
    }

    // Nuki refuses an action the device cannot carry out with a 400 - a lock
    // without a latch asked to unlatch, a US device that has none. Trying the
    // weaker action after it would open the door another way than the
    // administration set, so this is the access point's setup to correct.
    if (status === 400) {
      return AccessOpenError.configuration(
        `Nuki refused the action on smartlock '${accessPoint.externalId}' - the device cannot carry out this open action: ${detail}`,
      );
    }

    if (status === 401 || status === 403) {
      return AccessOpenError.configuration(
        `Nuki refused the action on smartlock '${accessPoint.externalId}' - check the API token: ${detail}`,
      );
    }

    return AccessOpenError.temporary(
      `Nuki open of smartlock '${accessPoint.externalId}' failed: ${detail}`,
    );
  }

  /**
   * The lock's state as the Nuki Web API reports it, reduced to the three
   * questions of a LockStatus: `open` is whether the lock currently grants
   * access (unlocked, unlatched, lock'n'go), `locked` whether the bolt is
   * thrown, `doorOpen` what the door sensor says where there is one.
   *
   * @param {Object} accessPoint The access point to read
   * @param {Object} bookingContext The booking it is read for
   * @returns {Promise<import("./access-provider").LockStatus>}
   */
  async getStatus(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const state = await client.getSmartlockState(accessPoint.externalId);

    return { open: state.open, locked: state.locked, doorOpen: state.doorOpen };
  }

  /**
   * Creates a keypad code at the smartlock for the access window of the
   * booking. Nuki creates the authorization asynchronously and answers the
   * create with nothing, so the id of the grant is read from the listing
   * afterwards: the newest keypad authorization with this grant's name and
   * code. A NUKI grant has no external principal - the code is all there
   * is.
   *
   * @param {Object} accessPoint The access point to grant access to
   * @param {Object} bookingContext The booking that gets access
   * @returns {Promise<import("./access-provider").Grant>}
   * @throws {Error} Nuki's own error, or one of our own when the created
   *   authorization never turns up in the listing
   */
  async grantAuthorization(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const secret = bookingContext.pin || this._generatePin();
    const name = this._buildAuthorizationName(accessPoint, bookingContext);

    if (!KEYPAD_CODE.test(secret)) {
      throw new Error(
        `'${secret}' is not a Nuki keypad code: six digits from 1 to 9, not starting with 12`,
      );
    }

    await client.createAuthorization(accessPoint.externalId, {
      name,
      type: NUKI_AUTH_TYPES.KEYPAD,
      allowedFromDate: this._formatDate(
        bookingContext.accessFrom ?? bookingContext.timeBegin,
      ),
      allowedUntilDate: this._formatDate(
        bookingContext.accessTo ?? bookingContext.timeEnd,
      ),
      code: Number(secret),
    });

    const authorizationId = await this._findCreatedAuthorization(
      client,
      accessPoint,
      name,
      secret,
    );

    return { authorizationId, externalPrincipalId: null, secret };
  }

  /**
   * @private
   * The id of the authorization just created, once Nuki lists it.
   *
   * @param {Object} client The tenant's Nuki API client
   * @param {Object} accessPoint The access point the code was created at
   * @param {string} name The name the authorization was created with
   * @param {string} secret The keypad code it was created with
   * @returns {Promise<string>} The authorization id
   * @throws {Error} When the listing still misses it after the last attempt
   */
  async _findCreatedAuthorization(client, accessPoint, name, secret) {
    const { attempts, delayMs } = this._authorizationLookup;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const listed = await client.getAuthorizations(accessPoint.externalId);
      const created = (Array.isArray(listed) ? listed : [])
        .filter(
          (authorization) =>
            authorization.name === name &&
            String(authorization.code) === String(secret),
        )
        .sort((a, b) =>
          String(a.creationDate || "").localeCompare(
            String(b.creationDate || ""),
          ),
        )
        .pop();

      if (created?.id != null) {
        return String(created.id);
      }

      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      `Nuki did not list the keypad authorization '${name}' it was asked to create on smartlock '${accessPoint.externalId}'`,
    );
  }

  /**
   * Deletes the keypad code. An authorization Nuki no longer has is
   * nothing to do; there is no principal to remove.
   *
   * @param {Object} accessPoint The access point the grant was made for
   * @param {import("./access-provider").Grant} grant The grant to revoke
   * @returns {Promise<import("./access-provider").Revocation>}
   */
  async revokeAuthorization(accessPoint, grant) {
    const authorizationId = grant?.authorizationId;

    if (!authorizationId) {
      return { principalRemoved: null };
    }

    const client = await this._getClient(accessPoint.tenantId);

    try {
      await client.deleteAuthorization(accessPoint.externalId, authorizationId);
    } catch (err) {
      if (err?.response?.status !== 404) {
        throw err;
      }
    }

    return { principalRemoved: null };
  }

  async listAccessPoints(tenant) {
    const client = await this._getClient(tenant);
    const smartlocks = await client.getSmartlocks();
    const list = Array.isArray(smartlocks)
      ? smartlocks
      : smartlocks?.smartlocks;

    return (list || []).map((smartlock) => {
      const capabilities = NukiApiClient.getCapabilitiesForSmartlock(smartlock);

      return {
        id: String(smartlock.smartlockId || smartlock.id),
        type: "door",
        provider: PROVIDER_ID,
        externalId: String(smartlock.smartlockId || smartlock.id),
        locationId: smartlock.accountId ? String(smartlock.accountId) : null,
        label: smartlock.name || smartlock.label || "",
        capabilities,
        supportedModes: deriveSupportedModes(capabilities),
        supportedOpenActions:
          NukiApiClient.supportedOpenActionsForSmartlock(smartlock),
        metadata: smartlock,
      };
    });
  }

  async getSupportedModes(accessPoint, tenant) {
    const client = await this._getClient(tenant);
    const smartlock = await client.getSmartlock(accessPoint.externalId);
    const capabilities = NukiApiClient.getCapabilitiesForSmartlock(smartlock);

    return deriveSupportedModes(capabilities);
  }

  /**
   * Position of the smartlock, read from the same `/smartlock` data the sync
   * already uses. Nuki knows coordinates but no address, so the prefill is
   * coordinates only.
   *
   * @param {Object} accessPoint The access point to locate
   * @param {string} tenant Tenant the access point belongs to
   * @returns {Promise<Object|null>} A location with coordinates, or null when
   *   the smartlock carries no usable position
   */
  async getLocation(accessPoint, tenant) {
    const client = await this._getClient(tenant);
    const smartlock = await client.getSmartlock(accessPoint.externalId);

    return NukiApiClient.getLocationForSmartlock(smartlock);
  }

  async registerWebhook(tenant, callbackUrl) {
    const client = await this._getClient(tenant);
    return client.registerNotification(callbackUrl);
  }

  async unregisterWebhook(tenant, id) {
    if (!id) {
      return { success: true, skipped: true, reason: "missing notificationId" };
    }

    const client = await this._getClient(tenant);
    return client.unregisterNotification(id);
  }

  parseWebhook(rawPayload, _headers = {}) {
    const payload =
      typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    return {
      provider: PROVIDER_ID,
      externalId: String(payload.smartlockId || payload.id || ""),
      eventType: payload.event || payload.action || payload.stateName || null,
      timestamp: payload.timestamp || payload.date || Date.now(),
      payload,
    };
  }

  verifyWebhookSignature(rawPayload, headers = {}, secret = null) {
    if (!secret) {
      return true;
    }

    const signature =
      headers["x-nuki-signature"] ||
      headers["X-Nuki-Signature"] ||
      headers["x-signature"];

    if (!signature) {
      return false;
    }

    const body =
      typeof rawPayload === "string"
        ? rawPayload
        : JSON.stringify(rawPayload || {});
    const expected = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return this._safeEqual(signature.replace(/^sha256=/, ""), expected);
  }

  _buildAuthorizationName(accessPoint, bookingContext) {
    const label = accessPoint.label ? ` ${accessPoint.label}` : "";
    return `Booking ${bookingContext.bookingId}${label}`
      .trim()
      .slice(0, AUTHORIZATION_NAME_MAX_LENGTH);
  }

  _formatDate(value) {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "number") {
      return new Date(value).toISOString();
    }

    return value;
  }

  _generatePin() {
    let pin;
    do {
      pin = Array.from(
        { length: 6 },
        () => KEYPAD_DIGITS[crypto.randomInt(KEYPAD_DIGITS.length)],
      ).join("");
    } while (!KEYPAD_CODE.test(pin));
    return pin;
  }

  _safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    if (left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  }

  static get capabilities() {
    return [
      "open",
      "close",
      "unlatch",
      "getStatus",
      "grantAuthorization",
      "revokeAuthorization",
      "listAccessPoints",
      "getSupportedModes",
      "getLocation",
      "registerWebhook",
      "unregisterWebhook",
      "parseWebhook",
      "verifyWebhookSignature",
    ];
  }
}

module.exports = NukiAccessProvider;
