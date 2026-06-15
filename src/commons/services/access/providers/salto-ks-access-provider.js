const crypto = require("crypto");
const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../clients/access-client-registry");
const { AccessPointMode } = require("../../../entities/access/access-point");

require("../clients");

const APP_TYPE = "access";
const PROVIDER_ID = "salto-ks";

// Salto KS is authorization-driven and additionally supports remote open, so
// every Salto lock can be used in remote, authorization and both modes.
const SALTO_SUPPORTED_MODES = Object.freeze([
  AccessPointMode.REMOTE,
  AccessPointMode.AUTHORIZATION,
  AccessPointMode.BOTH,
]);

class SaltoKsAccessProvider extends AccessProvider {
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
    const providerResponse = await client.openLock(accessPoint.externalId, {
      otp: bookingContext.openOptions?.otp || null,
    });

    return {
      success: true,
      state: "open",
      providerResponse,
    };
  }

  async getStatus(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const locks = await client.getLocks();
    const list = this._extractList(locks);
    const lock = list.find(
      (l) => String(l.id || l.lockId) === String(accessPoint.externalId),
    );

    console.log(`getStatus for accessPoint ${accessPoint.externalId}:`, lock);

    return {
      lockId: String(accessPoint.externalId),
      name: lock?.customer_reference || "",
      online: lock?.online ?? null,
      batteryLevel: lock?.battery_level ?? null,
      batteryCritical:
        lock?.battery_level === "critical" ? true : null,
      providerResponse: lock || null,
    };
  }

  async grantAuthorization(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const pin = bookingContext.pin || this._generatePin();

    const userResponse = await client.createUser(
      this._buildUser(bookingContext),
    );
    const saltoUserId =
      userResponse?.id || userResponse?.userId || userResponse?.user?.id;

    if (!saltoUserId) {
      throw new Error("Salto KS createUser returned no user id");
    }

    const accessResponse = await client.assignAccess(
      saltoUserId,
      [accessPoint.externalId],
      this._formatDate(bookingContext.accessFrom ?? bookingContext.timeBegin),
      this._formatDate(bookingContext.accessTo ?? bookingContext.timeEnd),
      pin,
    );

    const accessId =
      accessResponse?.id ||
      accessResponse?.accessId ||
      accessResponse?.access?.id ||
      null;

    return {
      authorizationId: accessId,
      saltoUserId,
      accessId,
      pin,
      providerResponse: { user: userResponse, access: accessResponse },
    };
  }

  async revokeAuthorization(accessPoint, bookingContext) {
    const accessId =
      bookingContext.accessId ||
      bookingContext.authorizationId ||
      bookingContext.accessInfo?.accessId ||
      accessPoint.authorizationId;
    const saltoUserId =
      bookingContext.saltoUserId ||
      bookingContext.accessInfo?.saltoUserId ||
      accessPoint.saltoUserId;

    if (!accessId && !saltoUserId) {
      return {
        success: true,
        skipped: true,
        reason: "missing accessId and saltoUserId",
      };
    }

    const client = await this._getClient(bookingContext.tenant);
    const providerResponse = {};
    let userDeleted = null;

    if (accessId) {
      providerResponse.access = await client.revokeAccess(accessId);
    }

    // Deleting the per-booking user is best-effort: a failure here must not
    // block the revoke (the cleanup job removes orphaned users later).
    if (saltoUserId) {
      try {
        providerResponse.user = await client.deleteUser(saltoUserId);
        userDeleted = true;
      } catch (err) {
        providerResponse.userDeleteError = err.message;
        userDeleted = false;
      }
    }

    return {
      success: true,
      authorizationId: accessId || null,
      saltoUserId: saltoUserId || null,
      accessId: accessId || null,
      userDeleted,
      providerResponse,
    };
  }

  async listAccessPoints(tenant) {
    const client = await this._getClient(tenant);
    const locks = await client.getLocks();
    const list = this._extractList(locks);

    return list.map((lock) => {
      const externalId = String(lock.id || lock.lockId);

      return {
        id: externalId,
        type: "door",
        provider: PROVIDER_ID,
        externalId,
        locationId: lock.siteId ? String(lock.siteId) : null,
        label: lock.name || lock.label || "",
        capabilities: ["remote", "authorization"],
        supportedModes: SALTO_SUPPORTED_MODES,
        metadata: lock,
      };
    });
  }

  async getSupportedModes() {
    return SALTO_SUPPORTED_MODES;
  }

  async registerWebhook(tenant, callbackUrl) {
    const client = await this._getClient(tenant);
    return client.subscribeNotifications(callbackUrl);
  }

  async unregisterWebhook(tenant, subscriptionId) {
    if (!subscriptionId) {
      return { success: true, skipped: true, reason: "missing subscriptionId" };
    }

    const client = await this._getClient(tenant);
    return client.unsubscribeNotifications(subscriptionId);
  }

  parseWebhook(rawPayload) {
    const payload =
      typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    return {
      provider: PROVIDER_ID,
      externalId: String(payload.lockId || payload.lock_id || payload.id || ""),
      eventType:
        payload.eventType ||
        payload.event ||
        payload.type ||
        payload.name ||
        null,
      timestamp:
        payload.timestamp || payload.eventTime || payload.date || Date.now(),
      payload,
    };
  }

  verifyWebhookSignature(rawPayload, headers = {}, secret = null) {
    if (!secret) {
      return true;
    }

    const signature =
      headers["x-salto-signature"] ||
      headers["X-Salto-Signature"] ||
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

  _extractList(locks) {
    if (Array.isArray(locks)) {
      return locks;
    }
    return locks?.locks || locks?.items || locks?.data || [];
  }

  _buildUser(bookingContext) {
    const booking = bookingContext.booking || {};
    const fullName = (booking.name || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName =
      parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;
    const lastName = parts.length > 1 ? parts[parts.length - 1] : "";

    return {
      firstName: firstName || `Booking ${bookingContext.bookingId}`,
      lastName,
      email: booking.mail || "",
    };
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
      "getStatus",
      "grantAuthorization",
      "revokeAuthorization",
      "listAccessPoints",
      "getSupportedModes",
      "registerWebhook",
      "unregisterWebhook",
      "parseWebhook",
      "verifyWebhookSignature",
    ];
  }
}

module.exports = SaltoKsAccessProvider;
