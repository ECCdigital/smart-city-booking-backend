const crypto = require("crypto");
const AccessProvider = require("./access-provider");
const { createClient } = require("../clients/access-client-registry");
const {
  classifySaltoError,
  extractSaltoList,
} = require("../clients/salto-ks-api-client");
const SaltoKsIqActivationService = require("../salto-ks-iq-activation-service");
const { AccessPointMode } = require("../../../entities/access/access-point");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");

require("../clients");

const PROVIDER_ID = "salto-ks";

// The lock types with a keypad - the only ones that know the Salto-Guest+PIN
// path (ADR 0001). Remote open is open to every door hanging on an IQ.
const KEYPAD_LOCK_TYPES = Object.freeze(["escutcheon_pin", "wall_reader_pin"]);

class SaltoKsAccessProvider extends AccessProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] A ready API client used for every tenant
   *   instead of one built from the tenant's application. Tests inject a fake
   *   here; the registry constructs the provider without one.
   */
  constructor({ client = null } = {}) {
    super();
    this._client = client;
    // Which IQ a lock hangs on, remembered from the last lock listing per
    // tenant. Only used to refuse locally (backoff, missing activation)
    // before any Salto call - a successful path always re-reads live data,
    // so a stale mapping can never compute an OTP from the wrong IQ.
    this._knownIqByLock = new Map();
  }

  async _getApp(tenant) {
    return SaltoKsIqActivationService.getSaltoApp(tenant);
  }

  async _getClient(tenant) {
    return this._client || createClient(await this._getApp(tenant));
  }

  /**
   * Opens the lock as the tenant's system user. The OTP is always computed by
   * the backend from the stored activation of the lock's IQ - never taken
   * from the caller - and at most one OTP is spent per attempt: a rejection
   * is booked and reported, not retried with a fresh computation.
   *
   * @throws {AccessOpenError} With the failure class the guest may see;
   *   the message carries the Salto detail for the audit log.
   */
  async open(accessPoint, bookingContext) {
    const tenant = bookingContext.tenant;
    const lockId = String(accessPoint.externalId);

    // A lock whose IQ is already known can be refused - backoff after
    // otp_blocked, missing activation - without any Salto call (§4/§7 of the
    // spec). When this passes, the attempt continues on live data.
    const knownIq = this._knownIqByLock.get(`${tenant}:${lockId}`);
    if (knownIq) {
      await SaltoKsIqActivationService.resolveOtpForOpen(tenant, knownIq);
    }

    const client = await this._getClient(tenant);
    const [locks, iqs] = await Promise.all([
      client.getLocks(),
      client.getIqs(),
    ]);
    const lock = extractSaltoList(locks).find(
      (l) => String(l.id || l.lockId) === lockId,
    );

    if (!lock) {
      throw AccessOpenError.configuration(
        `Salto KS does not list lock '${lockId}'`,
      );
    }

    const iq = lock.iq
      ? { id: String(lock.iq.id), otp_enabled: lock.iq.otp_enabled ?? false }
      : null;

    if (iq) {
      this._knownIqByLock.set(`${tenant}:${lockId}`, iq);

      const liveIq = extractSaltoList(iqs).find(
        (candidate) => String(candidate.id) === iq.id,
      );
      if (liveIq?.restore_required) {
        // §7: the IQ was reset - the stored ingredients are dead. Book it so
        // the capability is withdrawn and the admin sees why.
        await SaltoKsIqActivationService.markReactivationRequired(
          tenant,
          iq.id,
          "restore_required reported by Salto during an open attempt",
        );
        throw AccessOpenError.configuration(
          `Salto KS IQ ${iq.id} requires a restore - re-activation needed`,
        );
      }
    }

    const { otp } = iq
      ? await SaltoKsIqActivationService.resolveOtpForOpen(tenant, iq)
      : { otp: null };

    let providerResponse;
    try {
      providerResponse = await client.openLock(lockId, { otp });
    } catch (err) {
      throw await this._mapOpenError(err, tenant, iq);
    }

    if (otp) {
      await SaltoKsIqActivationService.recordOpenSuccess(tenant, iq.id);
    }

    return {
      success: true,
      state: "open",
      providerResponse,
    };
  }

  /**
   * @private
   * Books a failed locking call on the IQ's activation and turns it into the
   * failure class the guest sees (§7 of the spec): OTP rejections and an
   * offline lock are temporary, a missing right of the system user - which
   * only ever shows itself here - is configurative.
   */
  async _mapOpenError(err, tenant, iq) {
    const kind = classifySaltoError(err);
    const detail = err.message || String(err);

    if (kind === "otp_invalid" && iq) {
      await SaltoKsIqActivationService.recordOtpInvalid(tenant, iq.id, detail);
      return AccessOpenError.temporary(`Salto KS rejected the OTP: ${detail}`);
    }

    if (kind === "otp_blocked" && iq) {
      await SaltoKsIqActivationService.recordOtpBlocked(tenant, iq.id, detail);
      return AccessOpenError.temporary(
        `Salto KS blocked OTP submissions: ${detail}`,
      );
    }

    if (kind === "forbidden") {
      return AccessOpenError.configuration(
        `Salto KS refused the remote open - check the system user's remote locking right: ${detail}`,
      );
    }

    return AccessOpenError.temporary(`Salto KS open failed: ${detail}`);
  }

  async getStatus(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const locks = await client.getLocks();
    const list = extractSaltoList(locks);
    const lock = list.find(
      (l) => String(l.id || l.lockId) === String(accessPoint.externalId),
    );

    const lockedState = lock?.locked_state ?? null;

    return {
      lockId: String(accessPoint.externalId),
      name: lock?.customer_reference || "",
      online: lock?.online ?? null,
      state:
        lockedState === "locked"
          ? "locked"
          : lockedState === "unlocked"
            ? "unlocked"
            : null,
      lockedState,
      batteryLevel: lock?.battery_level ?? null,
      batteryCritical: lock?.battery_level === "critical" ? true : null,
      leftOpenAlarm: lock?.left_open_alarm ?? null,
      intrusionAlarm: lock?.intrusion_alarm ?? null,
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

  /**
   * The access points of the site, each with the modes its lock really
   * supports right now (§6 of the spec): the keypad path follows the lock
   * type, remote open additionally needs the lock's IQ to be locally
   * activated (IQs without `otp_enabled` need no activation) and not in
   * `restore_required`. Deliberately no condition on `online` - an offline IQ
   * is a runtime failure of the open attempt, not a capability.
   */
  async listAccessPoints(tenant) {
    const app = await this._getApp(tenant);
    const client = this._client || createClient(app);
    const [locks, iqs] = await Promise.all([
      client.getLocks(),
      client.getIqs(),
    ]);
    const iqList = extractSaltoList(iqs);
    const activations = Array.isArray(app.iqActivations)
      ? app.iqActivations
      : [];

    return extractSaltoList(locks).map((lock) => {
      const externalId = String(lock.id || lock.lockId);
      const supportedModes = this._deriveSupportedModes(
        lock,
        iqList,
        activations,
      );
      const capabilities = [];
      if (supportedModes.includes(AccessPointMode.REMOTE)) {
        capabilities.push("remote");
      }
      if (supportedModes.includes(AccessPointMode.AUTHORIZATION)) {
        capabilities.push("authorization");
      }

      return {
        id: externalId,
        type: "door",
        provider: PROVIDER_ID,
        externalId,
        locationId: lock.siteId ? String(lock.siteId) : null,
        label: lock.customer_reference || "",
        capabilities,
        supportedModes,
        metadata: lock,
      };
    });
  }

  async getSupportedModes(accessPoint, tenant) {
    const points = await this.listAccessPoints(tenant);
    const externalId = String(accessPoint.externalId);
    const point = points.find((p) => p.externalId === externalId);
    return point ? point.supportedModes : null;
  }

  /**
   * @private
   * The capability rule for one lock. `lock_type` stays provider runtime
   * knowledge - it is read from the live lock, never persisted.
   */
  _deriveSupportedModes(lock, iqList, activations) {
    const modes = [];

    if (KEYPAD_LOCK_TYPES.includes(lock.lock_type)) {
      modes.push(AccessPointMode.AUTHORIZATION);
    }

    if (this._supportsRemoteOpen(lock, iqList, activations)) {
      modes.unshift(AccessPointMode.REMOTE);
    }

    if (
      modes.includes(AccessPointMode.REMOTE) &&
      modes.includes(AccessPointMode.AUTHORIZATION)
    ) {
      modes.push(AccessPointMode.BOTH);
    }

    return modes;
  }

  /**
   * @private
   */
  _supportsRemoteOpen(lock, iqList, activations) {
    const iqId = lock.iq ? String(lock.iq.id) : null;
    if (!iqId) {
      return false;
    }

    const iq = iqList.find((candidate) => String(candidate.id) === iqId);
    if (iq?.restore_required) {
      return false;
    }

    const entry = activations.find((a) => a.iqId === iqId);
    const otpEnabled = iq
      ? iq.otp_enabled ?? false
      : lock.iq.otp_enabled ?? false;

    if (!otpEnabled) {
      return true;
    }

    // `degraded` keeps the capability for guests - it only raises the admin
    // hint; `reactivation_required` withdraws it.
    return ["activated", "degraded"].includes(entry?.state);
  }

  // No getLocation: the Salto KS Connect API carries no geo data - a site knows
  // only its country code and time zone, a lock only its floor inside the
  // building. Leaving the optional capability undeclared is what tells an admin
  // UI not to offer a location prefill that could never fill anything in.

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
