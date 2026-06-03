const crypto = require("crypto");
const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const {
  createClient,
} = require("../clients/access-client-registry");
const { NUKI_ACTIONS } = require("../clients/nuki-api-client");

require("../clients");

const APP_TYPE = "access";
const PROVIDER_ID = "nuki";

class NukiAccessProvider extends AccessProvider {
  async _getClient(tenant) {
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

  async open(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const providerResponse = await client.executeAction(
      accessPoint.externalId,
      NUKI_ACTIONS.UNLOCK,
    );

    return {
      success: true,
      state: "open",
      providerResponse,
    };
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
      allowedFromDate: this._formatDate(bookingContext.timeBegin),
      allowedUntilDate: this._formatDate(bookingContext.timeEnd),
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
      return { success: true, skipped: true, reason: "missing authorizationId" };
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
    const list = Array.isArray(smartlocks) ? smartlocks : smartlocks?.smartlocks;

    return (list || []).map((smartlock) => ({
      id: String(smartlock.smartlockId || smartlock.id),
      type: "door",
      provider: PROVIDER_ID,
      externalId: String(smartlock.smartlockId || smartlock.id),
      locationId: smartlock.accountId ? String(smartlock.accountId) : null,
      label: smartlock.name || smartlock.label || "",
      metadata: smartlock,
    }));
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
      "getStatus",
      "grantAuthorization",
      "revokeAuthorization",
      "listAccessPoints",
      "registerWebhook",
      "unregisterWebhook",
      "parseWebhook",
      "verifyWebhookSignature",
    ];
  }
}

module.exports = NukiAccessProvider;
