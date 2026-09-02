const crypto = require("crypto");
const bunyan = require("bunyan");
const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../clients/access-client-registry");
const { NukiApiClient, NUKI_ACTIONS } = require("../clients/nuki-api-client");
const {
  deriveSupportedModes,
} = require("../../../entities/access/access-point");

require("../clients");

const APP_TYPE = "access";
const PROVIDER_ID = "nuki";

const logger = bunyan.createLogger({
  name: "nuki-access-provider.js",
  level: process.env.LOG_LEVEL,
});

class NukiAccessProvider extends AccessProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] A ready API client used for every tenant
   *   instead of one built from the tenant's application. Tests inject a fake
   *   here; the registry constructs the provider without one.
   */
  constructor({ client = null } = {}) {
    super();
    this._client = client;
  }

  async _getClient(tenant) {
    if (this._client) {
      return this._client;
    }

    const tenantData = await TenantManager.getTenant(tenant);
    const rawApp = tenantData?.applications?.find(
      (a) => a.type === APP_TYPE && a.id === PROVIDER_ID && a.active,
    );

    if (!rawApp) {
      throw new Error(
        `No active access application '${PROVIDER_ID}' found for tenant '${tenant}'`,
      );
    }

    return createClient(rawApp);
  }

  /**
   * Opens the access point: pulls the latch where the lock has one, releases
   * the lock where it has not. For the person at the door that is the
   * difference between "the door is open" and "it is unlocked, now push".
   *
   * The decision is made here and per lock, never by the client: `unlatch` is
   * guarded like `open`, but a client that could choose the action could also
   * choose the weaker route. There is no falling back either - a lock that
   * cannot pull its latch is asked to unlock right away, so nobody waits out a
   * failed action in front of the door.
   *
   * @param {Object} accessPoint The access point to open
   * @param {Object} bookingContext The booking the door is opened for
   * @returns {Promise<Object>} The provider's answer to the action
   */
  async open(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const action = (await this._hasLatch(client, accessPoint))
      ? NUKI_ACTIONS.UNLATCH
      : NUKI_ACTIONS.UNLOCK;
    const providerResponse = await client.executeAction(
      accessPoint.externalId,
      action,
    );

    return {
      success: true,
      state: "open",
      providerResponse,
    };
  }

  /**
   * @private
   * Whether this lock has a latch to pull, read from the smartlock itself:
   * the provider declares `unlatch` for every Nuki access point, but an opener
   * or a box has no latch.
   *
   * A lookup that fails is answered with "no latch": the door then opens the
   * way it always did instead of not opening at all.
   *
   * @param {Object} client The tenant's Nuki API client
   * @param {Object} accessPoint The access point being opened
   * @returns {Promise<boolean>} True if this lock has a latch to pull
   */
  async _hasLatch(client, accessPoint) {
    try {
      const smartlock = await client.getSmartlock(accessPoint.externalId);

      return NukiApiClient.canUnlatchSmartlock(smartlock);
    } catch (err) {
      logger.warn(
        `Could not read smartlock ${accessPoint.externalId} to decide on its latch, unlocking instead: ${err.message}`,
      );
      return false;
    }
  }

  async close(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const providerResponse = await client.executeAction(
      accessPoint.externalId,
      NUKI_ACTIONS.LOCK,
    );

    return {
      success: true,
      state: "closed",
      providerResponse,
    };
  }

  // Pulls the latch so the door physically opens, instead of only releasing
  // the lock (unlock). Requires a Nuki actor that is mounted on a door with a
  // latch (i.e. not an Opener/Box).
  async unlatch(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const providerResponse = await client.executeAction(
      accessPoint.externalId,
      NUKI_ACTIONS.UNLATCH,
    );

    return {
      success: true,
      state: "open",
      providerResponse,
    };
  }

  async getStatus(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    return client.getSmartlockState(accessPoint.externalId);
  }

  async grantAuthorization(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const pin = bookingContext.pin || this._generatePin();
    const authorization = {
      name: this._buildAuthorizationName(accessPoint, bookingContext),
      type: "keypad",
      allowedFromDate: this._formatDate(
        bookingContext.accessFrom ?? bookingContext.timeBegin,
      ),
      allowedUntilDate: this._formatDate(
        bookingContext.accessTo ?? bookingContext.timeEnd,
      ),
      code: pin,
    };

    const providerResponse = await client.createAuthorization(
      accessPoint.externalId,
      authorization,
    );

    return {
      authorizationId:
        providerResponse?.id ||
        providerResponse?.authId ||
        providerResponse?.authorizationId ||
        null,
      pin,
      providerResponse,
    };
  }

  async revokeAuthorization(accessPoint, bookingContext) {
    const authorizationId =
      bookingContext.authorizationId || accessPoint.authorizationId;

    if (!authorizationId) {
      return {
        success: true,
        skipped: true,
        reason: "missing authorizationId",
      };
    }

    const client = await this._getClient(bookingContext.tenant);
    const providerResponse = await client.deleteAuthorization(
      accessPoint.externalId,
      authorizationId,
    );

    return {
      success: true,
      authorizationId,
      providerResponse,
    };
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

  async unregisterWebhook(tenant, notificationId) {
    if (!notificationId) {
      return { success: true, skipped: true, reason: "missing notificationId" };
    }

    const client = await this._getClient(tenant);
    return client.unregisterNotification(notificationId);
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
    return `Booking ${bookingContext.bookingId}${label}`.trim();
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
    return String(crypto.randomInt(100000, 1000000));
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
