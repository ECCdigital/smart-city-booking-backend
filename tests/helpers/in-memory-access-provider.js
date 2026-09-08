/**
 * An access provider with no hardware behind it: locks, their state and the
 * grants made for them live in memory. It is the fourth implementation of
 * the access provider contract and the one tests reach for when they need a
 * provider that behaves, without a fake API client in between.
 *
 * Registered in tests only - production never sees it.
 */

const AccessProvider = require("../../src/commons/services/access/providers/access-provider");
const {
  AccessPointMode,
} = require("../../src/commons/entities/access/access-point");
const { AccessOpenError } = require("../../src/errors/AccessOpenError");

const PROVIDER_ID = "in-memory";

class InMemoryAccessProvider extends AccessProvider {
  /**
   * @param {Object} [options]
   * @param {Object[]} [options.locks] Locks the provider knows, each
   *   `{ externalId, label?, locked?, doorOpen?, supportedModes? }`
   * @param {boolean} [options.broken=false] Whether every call fails the way
   *   an unreachable provider would
   * @param {boolean} [options.principalRemovalFails=false] Whether a revoke
   *   takes the grant back but cannot remove its principal - the case the
   *   cleanup job exists for
   */
  constructor({
    locks = [],
    broken = false,
    principalRemovalFails = false,
  } = {}) {
    super();
    this.locks = new Map(
      locks.map((lock) => [
        String(lock.externalId),
        {
          label: "",
          locked: true,
          doorOpen: null,
          supportedModes: [
            AccessPointMode.REMOTE,
            AccessPointMode.AUTHORIZATION,
            AccessPointMode.BOTH,
          ],
          ...lock,
        },
      ]),
    );
    /** @type {Map<string, Object>} authorization id -> grant */
    this.grants = new Map();
    /** @type {Set<string>} the external principals still held */
    this.principals = new Set();
    this.principalRemovalFails = principalRemovalFails;
    /** @type {{ externalId: string, action: string }[]} every action taken */
    this.actions = [];
    this.broken = broken;
    this._nextId = 1;
  }

  async open(accessPoint, _bookingContext) {
    const lock = this._lock(accessPoint);
    lock.locked = false;
    this.actions.push({
      externalId: String(accessPoint.externalId),
      action: "open",
    });
    return { state: "opened", openProcessId: null };
  }

  async unlatch(accessPoint, bookingContext) {
    return this.open(accessPoint, bookingContext);
  }

  async close(accessPoint, _bookingContext) {
    const lock = this._lock(accessPoint);
    lock.locked = true;
    this.actions.push({
      externalId: String(accessPoint.externalId),
      action: "close",
    });
  }

  async getStatus(accessPoint, _bookingContext) {
    const lock = this._lock(accessPoint);
    return { open: !lock.locked, locked: lock.locked, doorOpen: lock.doorOpen };
  }

  async grantAuthorization(accessPoint, bookingContext) {
    this._lock(accessPoint);
    const authorizationId = `grant-${this._nextId++}`;
    const externalPrincipalId = `principal-${this._nextId++}`;
    const secret = bookingContext.pin || "123456";
    this.grants.set(authorizationId, {
      authorizationId,
      externalPrincipalId,
      externalId: String(accessPoint.externalId),
      bookingId: bookingContext.bookingId,
      secret,
    });
    this.principals.add(externalPrincipalId);
    return { authorizationId, externalPrincipalId, secret };
  }

  async revokeAuthorization(accessPoint, grant) {
    this._failIfBroken();
    // Revoking what is already gone is nothing to do, not a failure.
    this.grants.delete(grant?.authorizationId);
    if (!grant?.externalPrincipalId) {
      return { principalRemoved: null };
    }
    if (this.principalRemovalFails) {
      return { principalRemoved: false };
    }
    this.principals.delete(grant.externalPrincipalId);
    return { principalRemoved: true };
  }

  async listAccessPoints(_tenant) {
    this._failIfBroken();
    return [...this.locks.entries()].map(([externalId, lock]) => ({
      id: externalId,
      type: "door",
      provider: PROVIDER_ID,
      externalId,
      locationId: null,
      label: lock.label,
      capabilities: ["remote", "authorization"],
      supportedModes: lock.supportedModes,
      metadata: {},
    }));
  }

  async getSupportedModes(accessPoint, _tenant) {
    this._failIfBroken();
    const lock = this.locks.get(String(accessPoint.externalId));
    return lock ? lock.supportedModes : null;
  }

  async getLocation(_accessPoint, _tenant) {
    this._failIfBroken();
    return null;
  }

  _failIfBroken() {
    if (this.broken) {
      throw AccessOpenError.temporary(
        "in-memory access provider is unreachable",
      );
    }
  }

  _lock(accessPoint) {
    this._failIfBroken();
    const lock = this.locks.get(String(accessPoint.externalId));
    if (!lock) {
      throw AccessOpenError.configuration(
        `in-memory access provider knows no lock '${accessPoint.externalId}'`,
      );
    }
    return lock;
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
    ];
  }
}

module.exports = { InMemoryAccessProvider, PROVIDER_ID };
