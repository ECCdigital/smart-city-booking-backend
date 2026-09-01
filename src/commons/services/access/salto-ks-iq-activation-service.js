const bunyan = require("bunyan");
const TenantManager = require("../../data-managers/tenant-manager");
const TenantModel = require("../../data-managers/models/tenantModel");
const SecurityUtils = require("../../utilities/security-utils");
const clientRegistry = require("./clients/access-client-registry");
const { computeSaltoOtp } = require("./clients/salto-ks-otp");
const {
  classifySaltoError,
  extractSaltoList,
} = require("./clients/salto-ks-api-client");
const {
  BaseError,
  BadRequestError,
  NotFoundError,
} = require("../../../errors/BaseError");
const { AccessOpenError } = require("../../../errors/AccessOpenError");

require("./clients");

const APP_TYPE = "access";
const PROVIDER_ID = "salto-ks";

/**
 * The local states of an IQ activation. An IQ without an entry is
 * `not_activated` - implicit, never persisted.
 */
const IQ_ACTIVATION_STATES = Object.freeze({
  PENDING_PIN: "pending_pin",
  ACTIVATED: "activated",
  DEGRADED: "degraded",
  REACTIVATION_REQUIRED: "reactivation_required",
});

// Three otp_invalid in a row degrade the activation (admin hint "check
// re-activation"); the backoff after otp_blocked stays above Salto's ~20
// minute block with a buffer.
const DEGRADE_AFTER_FAILURES = 3;
const OTP_BLOCK_BACKOFF_MS = 25 * 60 * 1000;

const logger = bunyan.createLogger({
  name: "salto-ks-iq-activation-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * IQ activations of a tenant's Salto application: the wizard that earns the
 * OTP ingredients (first secret + mailed IQ-PIN), and the bookkeeping the
 * open path relies on (failure count, backoff after `otp_blocked`).
 *
 * The secret and the pin are encrypted at rest and stay encrypted on the
 * application entity; only this service decrypts them, at the moment an OTP
 * is computed. They never leave the backend.
 */
class SaltoKsIqActivationService {
  /**
   * The IQs of the tenant's site, live from Salto, merged with the local
   * activation state. No secrets, no pins - this is what the wizard and the
   * connection test render.
   *
   * Seeing `restore_required` on an IQ whose activation was working is the
   * moment the local state flips to `reactivation_required` (an IQ reset
   * invalidates the stored ingredients; the admin discards and re-runs the
   * wizard).
   *
   * @param {string} tenantId
   * @returns {Promise<Object[]>}
   */
  static async listIqs(tenantId) {
    const { app, client } = await this._getAppAndClient(tenantId);
    let activations = this._activationsOf(app);
    const iqs = extractSaltoList(await client.getIqs());

    for (const iq of iqs) {
      const entry = activations.find((a) => a.iqId === String(iq.id));
      if (
        iq.restore_required &&
        entry &&
        [
          IQ_ACTIVATION_STATES.ACTIVATED,
          IQ_ACTIVATION_STATES.DEGRADED,
        ].includes(entry.state)
      ) {
        activations = await this._patchEntry(
          tenantId,
          activations,
          entry.iqId,
          { state: IQ_ACTIVATION_STATES.REACTIVATION_REQUIRED },
        );
      }
    }

    return iqs.map((iq) => {
      const entry = activations.find((a) => a.iqId === String(iq.id));
      return {
        id: String(iq.id),
        customerReference: iq.customer_reference || "",
        otpEnabled: iq.otp_enabled ?? false,
        online: iq.online ?? null,
        restoreRequired: iq.restore_required ?? false,
        state: entry?.state || "not_activated",
        activatedAt: entry?.activatedAt || null,
        lastError: entry?.lastError || null,
      };
    });
  }

  /**
   * Keeps the IQ activations out of a tenant update's hands: the entries are
   * backend-owned runtime state, written only by this service, so whatever an
   * admin UI round-trips (or drops) is replaced by what is stored.
   *
   * @param {Object|null} previousTenant The stored tenant
   * @param {Object} nextTenant The tenant about to be stored
   * @returns {Object} `nextTenant`, with the stored activations restored
   */
  static preserveActivations(previousTenant, nextTenant) {
    const findApp = (tenant) =>
      tenant?.applications?.find(
        (a) => a.type === APP_TYPE && a.id === PROVIDER_ID,
      );

    const nextApp = findApp(nextTenant);
    if (nextApp) {
      nextApp.iqActivations = this._activationsOf(
        findApp(previousTenant) || {},
      );
    }

    return nextTenant;
  }

  /**
   * The locally known activation state per IQ, for callers that already have
   * the live IQ list (the connection test). `{}` when the tenant has no
   * stored Salto application - every IQ is then `not_activated`.
   *
   * @param {string} tenantId
   * @returns {Promise<Object<string, string>>} Map of IQ id to state
   */
  static async getLocalStates(tenantId) {
    if (!tenantId) {
      return {};
    }

    let app;
    try {
      app = await this.getSaltoApp(tenantId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {};
      }
      throw err;
    }

    return Object.fromEntries(
      this._activationsOf(app).map((a) => [a.iqId, a.state]),
    );
  }

  /**
   * Starts the activation of an IQ: fetches the single-shot first secret and
   * persists it encrypted **before** the PIN mail is triggered, so a wizard
   * lost after this call can be completed later with the mailed PIN.
   *
   * On an IQ already in `pending_pin` with a stored secret only the PIN mail
   * is repeated - the first secret exists exactly once.
   *
   * @param {string} tenantId
   * @param {string} iqId Salto IQ UUID
   * @returns {Promise<{iqId: string, state: string}>}
   * @throws {BadRequestError} `salto_iq_activation_exists` when the IQ is
   *   locally beyond `pending_pin` (discard first);
   *   `salto_iq_already_activated_at_salto` when Salto refuses the first
   *   secret because the system user was activated at this IQ before (app
   *   legacy) - not healable via API, see the setup guide.
   */
  static async startActivation(tenantId, iqId) {
    const { app, client } = await this._getAppAndClient(tenantId);
    const activations = this._activationsOf(app);
    const entry = activations.find((a) => a.iqId === iqId);

    if (entry && entry.state !== IQ_ACTIVATION_STATES.PENDING_PIN) {
      throw new BadRequestError("salto_iq_activation_exists", { iqId });
    }

    if (entry && entry.secret) {
      await client.sendIqPinEmail(iqId);
      return { iqId, state: entry.state };
    }

    let secret;
    try {
      secret = await client.getIqFirstSecret(iqId);
    } catch (err) {
      // Only Salto's own "already activated" answer (ErrorCode 2203) means
      // the app legacy of the setup guide - any other 403 (e.g. a missing
      // permission) is not healed by discarding and must surface as itself.
      if (
        err?.response?.status === 403 &&
        (err.response.data?.ErrorCode === 2203 ||
          `${err.response.data?.Message || err.message || ""}`
            .toLowerCase()
            .includes("already activated"))
      ) {
        throw new BadRequestError("salto_iq_already_activated_at_salto", {
          iqId,
        });
      }
      throw err;
    }

    if (!secret) {
      throw new BaseError("salto_iq_no_first_secret", 502, { iqId });
    }

    const next = activations
      .filter((a) => a.iqId !== iqId)
      .concat([
        {
          iqId,
          secret: SecurityUtils.encrypt(secret),
          pin: null,
          state: IQ_ACTIVATION_STATES.PENDING_PIN,
          activatedAt: null,
          failureCount: 0,
          blockedUntil: null,
          lastError: null,
        },
      ]);

    // The first secret is single-shot: persist before anything else can fail.
    await this._saveActivations(tenantId, next);

    try {
      await client.sendIqPinEmail(iqId);
    } catch (err) {
      logger.error(
        `${tenantId} -- Salto KS PIN mail for IQ ${iqId} failed: ${err.message}`,
      );
      await this._patchEntry(tenantId, next, iqId, { lastError: err.message });
      throw err;
    }

    return { iqId, state: IQ_ACTIVATION_STATES.PENDING_PIN };
  }

  /**
   * Completes the activation with the PIN Salto mailed to the system user's
   * mailbox (captured once by the admin): `PUT …/pin` with a self-computed
   * OTP and `delta: "0000"`, so the PIN stays the mailed one - a real delta
   * would reintroduce the PIN ambiguity that broke the 08-19 run.
   *
   * @param {string} tenantId
   * @param {string} iqId Salto IQ UUID
   * @param {string} pin The 4-digit mailed IQ-PIN
   * @returns {Promise<{iqId: string, state: string}>}
   * @throws {BadRequestError} `salto_iq_invalid_pin` for a malformed pin;
   *   `salto_iq_activation_not_started` without a stored secret;
   *   `salto_iq_activation_otp_rejected` when Salto refuses the OTP - the
   *   entry stays `pending_pin` so the admin can retry with the right PIN.
   */
  static async completeActivation(tenantId, iqId, pin) {
    if (!/^\d{4}$/.test(String(pin || ""))) {
      throw new BadRequestError("salto_iq_invalid_pin", { iqId });
    }

    const { app, client } = await this._getAppAndClient(tenantId);
    const activations = this._activationsOf(app);
    const entry = activations.find((a) => a.iqId === iqId);

    if (
      !entry ||
      entry.state !== IQ_ACTIVATION_STATES.PENDING_PIN ||
      !entry.secret
    ) {
      throw new BadRequestError("salto_iq_activation_not_started", { iqId });
    }

    const secret = SecurityUtils.decrypt(entry.secret);
    const otp = computeSaltoOtp(secret, pin);

    try {
      await client.putIqPin(iqId, { otp, delta: "0000" });
    } catch (err) {
      await this._patchEntry(tenantId, activations, iqId, {
        lastError: err.message,
      });

      // Only an OTP rejection means the entered PIN (or the stored secret)
      // is wrong; a network error or a 5xx is not the admin's doing and
      // surfaces as itself.
      const kind = classifySaltoError(err);
      if (kind === "otp_invalid" || kind === "otp_blocked") {
        throw new BadRequestError("salto_iq_activation_otp_rejected", {
          iqId,
          message: err.message,
        });
      }
      throw err;
    }

    await this._patchEntry(tenantId, activations, iqId, {
      pin: SecurityUtils.encrypt(pin),
      state: IQ_ACTIVATION_STATES.ACTIVATED,
      activatedAt: new Date(),
      failureCount: 0,
      blockedUntil: null,
      lastError: null,
    });

    return { iqId, state: IQ_ACTIVATION_STATES.ACTIVATED };
  }

  /**
   * Discards the local activation entry - back to the implicit
   * `not_activated`. Calls nothing at Salto; this is the basis of a
   * re-activation after an IQ reset, an IQ swap or an app legacy.
   *
   * @param {string} tenantId
   * @param {string} iqId Salto IQ UUID
   * @returns {Promise<{iqId: string, state: string}>}
   */
  static async discardActivation(tenantId, iqId) {
    const app = await this.getSaltoApp(tenantId);
    const activations = this._activationsOf(app);

    if (activations.some((a) => a.iqId === iqId)) {
      await this._saveActivations(
        tenantId,
        activations.filter((a) => a.iqId !== iqId),
      );
    }

    return { iqId, state: "not_activated" };
  }

  /**
   * The OTP for one open attempt at the IQ a lock hangs on - always computed
   * by the backend from the stored ingredients, never taken from a client
   * (the former `otp` parameter of the open endpoint is gone for good).
   *
   * Refuses locally, without a Salto call, when the activation state cannot
   * yield a working OTP: not activated / pending / reactivation required are
   * configuration failures, an active `otp_blocked` backoff a temporary one.
   * `degraded` still opens - it only raises the admin hint.
   *
   * @param {string} tenantId
   * @param {{id: string, otp_enabled?: boolean}} iq The IQ of the lock, from
   *   the provider's lock list
   * @returns {Promise<{otp: string|null}>} `null` when the IQ needs no OTP
   * @throws {AccessOpenError}
   */
  static async resolveOtpForOpen(tenantId, iq) {
    if (!iq?.otp_enabled) {
      return { otp: null };
    }

    const app = await this.getSaltoApp(tenantId);
    const entry = this._activationsOf(app).find((a) => a.iqId === iq.id);

    if (
      !entry ||
      entry.state === IQ_ACTIVATION_STATES.PENDING_PIN ||
      !entry.secret ||
      !entry.pin
    ) {
      throw AccessOpenError.configuration(
        `Salto KS IQ ${iq.id} is not activated for remote open`,
        { iqId: iq.id },
      );
    }

    if (entry.state === IQ_ACTIVATION_STATES.REACTIVATION_REQUIRED) {
      throw AccessOpenError.configuration(
        `Salto KS IQ ${iq.id} requires re-activation`,
        { iqId: iq.id },
      );
    }

    if (entry.blockedUntil && new Date(entry.blockedUntil) > new Date()) {
      throw AccessOpenError.temporary(
        `Salto KS IQ ${iq.id} is backing off until ${new Date(entry.blockedUntil).toISOString()} after otp_blocked`,
        { iqId: iq.id },
      );
    }

    const secret = SecurityUtils.decrypt(entry.secret);
    const pin = SecurityUtils.decrypt(entry.pin);
    return { otp: computeSaltoOtp(secret, pin) };
  }

  /**
   * Books a rejected OTP on the IQ's activation: consecutive rejections
   * degrade it after {@link DEGRADE_AFTER_FAILURES}.
   *
   * @param {string} tenantId
   * @param {string} iqId
   * @param {string} message The Salto error, for the admin view
   */
  static async recordOtpInvalid(tenantId, iqId, message) {
    await this._patchLoadedEntry(tenantId, iqId, (entry) => {
      const failureCount = (entry.failureCount || 0) + 1;
      return {
        failureCount,
        lastError: message || "otp_invalid",
        state:
          failureCount >= DEGRADE_AFTER_FAILURES &&
          entry.state === IQ_ACTIVATION_STATES.ACTIVATED
            ? IQ_ACTIVATION_STATES.DEGRADED
            : entry.state,
      };
    });
  }

  /**
   * Starts the local backoff after `otp_blocked`: until it passes, open
   * attempts at this IQ are refused without a Salto call.
   *
   * @param {string} tenantId
   * @param {string} iqId
   * @param {string} message The Salto error, for the admin view
   */
  static async recordOtpBlocked(tenantId, iqId, message) {
    await this._patchLoadedEntry(tenantId, iqId, () => ({
      blockedUntil: new Date(Date.now() + OTP_BLOCK_BACKOFF_MS),
      lastError: message || "otp_blocked",
    }));
  }

  /**
   * Books that Salto reported `restore_required` for the IQ: the stored
   * ingredients are dead, the capability is withdrawn until the admin
   * discards and re-runs the wizard.
   *
   * @param {string} tenantId
   * @param {string} iqId
   * @param {string} [message] What was seen, for the admin view
   */
  static async markReactivationRequired(tenantId, iqId, message) {
    await this._patchLoadedEntry(tenantId, iqId, () => ({
      state: IQ_ACTIVATION_STATES.REACTIVATION_REQUIRED,
      lastError: message || "restore_required",
    }));
  }

  /**
   * Removes the activation entries from a tenant that is about to leave
   * through the API: even encrypted, the OTP ingredients never travel
   * (docs/specs/salto-ks-remote-open.md paragraph 2). Safe because a tenant
   * update never writes them back - see {@link preserveActivations}.
   *
   * @param {Object|null} tenant The tenant answer to redact, mutated in place
   * @returns {Object|null} The same tenant
   */
  static redactActivations(tenant) {
    for (const app of tenant?.applications || []) {
      if (app.type === APP_TYPE && app.id === PROVIDER_ID) {
        delete app.iqActivations;
      }
    }
    return tenant;
  }

  /**
   * Books a successful open: the failure streak ends and a degraded
   * activation is proven healthy again.
   *
   * This is the only implemented healing arc. The spec's state machine also
   * allows an oracle success (`PUT …/pin` with `delta:"0000"`) to heal, but
   * defines no trigger for it - and an unprompted oracle call spends an OTP
   * submission, three of which block the command. So nothing runs the oracle
   * on its own; a degraded activation heals at the door or is discarded.
   *
   * @param {string} tenantId
   * @param {string} iqId
   */
  static async recordOpenSuccess(tenantId, iqId) {
    await this._patchLoadedEntry(tenantId, iqId, (entry) => ({
      failureCount: 0,
      blockedUntil: null,
      lastError: null,
      state:
        entry.state === IQ_ACTIVATION_STATES.DEGRADED
          ? IQ_ACTIVATION_STATES.ACTIVATED
          : entry.state,
    }));
  }

  /**
   * @private
   * The tenant's active Salto application and a client bound to it.
   */
  static async _getAppAndClient(tenantId) {
    const app = await this.getSaltoApp(tenantId);
    return { app, client: clientRegistry.createClient(app) };
  }

  /**
   * The tenant's active Salto application. Shared with the access provider -
   * one lookup, one error.
   */
  static async getSaltoApp(tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    const app = tenant?.applications?.find(
      (a) => a.type === APP_TYPE && a.id === PROVIDER_ID && a.active,
    );

    if (!app) {
      throw new NotFoundError("salto_ks_application_not_found", { tenantId });
    }

    return app;
  }

  static _activationsOf(app) {
    return Array.isArray(app.iqActivations) ? app.iqActivations : [];
  }

  /**
   * @private
   * Persists the activation list on the tenant's Salto application with a
   * targeted update, so concurrent tenant edits are not clobbered and the
   * entries (already encrypted) pass the tenant model's encryption hook
   * untouched.
   */
  static async _saveActivations(tenantId, activations) {
    await TenantModel.updateOne(
      {
        id: tenantId,
        applications: { $elemMatch: { type: APP_TYPE, id: PROVIDER_ID } },
      },
      { $set: { "applications.$.iqActivations": activations } },
    );
  }

  static async _patchEntry(tenantId, activations, iqId, patch) {
    const next = activations.map((a) =>
      a.iqId === iqId ? { ...a, ...patch } : a,
    );
    await this._saveActivations(tenantId, next);
    return next;
  }

  /**
   * @private
   * Loads the activation list fresh and patches one entry with the result of
   * `buildPatch(entry)`. A missing entry is left alone - there is nothing to
   * book failures or successes on.
   */
  static async _patchLoadedEntry(tenantId, iqId, buildPatch) {
    const app = await this.getSaltoApp(tenantId);
    const activations = this._activationsOf(app);
    const entry = activations.find((a) => a.iqId === iqId);

    if (!entry) {
      return;
    }

    await this._patchEntry(tenantId, activations, iqId, buildPatch(entry));
  }
}

module.exports = SaltoKsIqActivationService;
module.exports.IQ_ACTIVATION_STATES = IQ_ACTIVATION_STATES;
