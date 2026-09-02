/**
 * The seam `AccessService` talks to a locking system through. Every adapter
 * - NUKI, Salto KS, iFBS - extends this class, declares the methods it can
 * honour in `capabilities`, and answers the result-bearing ones in the
 * closed shapes declared below. The service branches on `capabilities`
 * only, never on what an adapter happens to have as a method, and it never
 * sees a raw provider answer: what an adapter cannot say in these shapes it
 * does not say.
 *
 * `tests/access-provider-contract.test.js` runs every adapter against this
 * contract.
 */

/**
 * What an open did. A provider that opens synchronously answers `opened`
 * with no process; one that only starts the open - iFBS hands the command
 * to the box and confirms later - answers `pending` with the process to
 * poll through {@link AccessProvider#getOpenProgress}.
 *
 * Invariant: `state === "pending"` exactly when `openProcessId !== null`.
 *
 * @typedef {Object} OpenOutcome
 * @property {"opened"|"pending"} state
 * @property {string|null} openProcessId
 */

/**
 * The state of the lock as far as the provider knows it. `null` means the
 * provider does not report this - not `false`. Nothing else: battery,
 * alarms and usage windows are provider detail that stays behind the seam.
 *
 * @typedef {Object} LockStatus
 * @property {boolean|null} open Whether the lock grants access right now
 * @property {boolean|null} locked Whether the bolt is thrown
 * @property {boolean|null} doorOpen Whether the door itself stands open,
 *   where a sensor can tell
 */

/**
 * How far a pending open has come. `confirmed` is `null` when the poll
 * itself failed and the provider cannot say; `errorCode` and `errorMessage`
 * then carry the provider's own reason.
 *
 * @typedef {Object} OpenProgress
 * @property {boolean|null} confirmed
 * @property {string|null} confirmedAt
 * @property {string|number|null} errorCode
 * @property {string|null} errorMessage
 */

/**
 * The booking an access point is operated for, as `AccessService` resolves
 * it. Adapters read what they need from it and write nothing back.
 *
 * @typedef {Object} BookingContext
 * @property {string} tenant
 * @property {string} bookingId
 * @property {number} timeBegin
 * @property {number} timeEnd
 * @property {number} [accessFrom] Start of the access window, buffer included
 * @property {number} [accessTo] End of the access window, buffer included
 * @property {Object} [booking] The booking itself
 * @property {string} [externalBookingId] The provider's own id of the
 *   booking, where the provider - iFBS - books on its side
 * @property {string} [pin] A PIN the caller chose for the grant
 * @property {string|null} [authorizationId] The grant to revoke
 */

/**
 * An access point as the provider lists it - the shape the sync stores.
 *
 * @typedef {Object} ListedAccessPoint
 * @property {string} id
 * @property {"door"|"locker"} type
 * @property {string} provider
 * @property {string} externalId
 * @property {string|null} locationId
 * @property {string} label
 * @property {string[]} capabilities The point's own capabilities, e.g.
 *   `remote`, `authorization`
 * @property {string[]} supportedModes The access point modes the lock
 *   really supports
 * @property {Object} metadata The provider's own record of the lock
 */

/**
 * A webhook event as the provider reports it, normalized to what the
 * service routes on.
 *
 * @typedef {Object} WebhookEvent
 * @property {string} provider
 * @property {string} externalId
 * @property {string|null} eventType
 * @property {number|string} timestamp
 * @property {Object} payload The event as it came in
 */

class AccessProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] A ready API client used for every tenant
   *   instead of one built from the tenant's application. Tests inject a fake
   *   here; the registry constructs the provider without one.
   */
  constructor({ client = null } = {}) {
    this._client = client;
  }

  /**
   * Opens the access point for the booking: pulls the latch where the lock
   * has one, releases the lock where it has not, hands the command to the
   * box where the provider is a locker system.
   *
   * @param {Object} accessPoint The access point to open
   * @param {BookingContext} bookingContext The booking it is opened for
   * @returns {Promise<OpenOutcome>} What the open did
   * @throws {AccessOpenError} Only ever this: `configuration` when the
   *   tenant, the lock or its setup are not as they should be, `temporary`
   *   for everything the provider or the network did not manage this time
   */
  async open(accessPoint, bookingContext) {
    throw new Error(`open() is not supported by ${this.constructor.name}`);
  }

  /**
   * Locks the access point again. Answers nothing: the state after a close
   * is what the lock says it is, and the service reads it through
   * {@link AccessProvider#getStatus}.
   *
   * @param {Object} accessPoint The access point to close
   * @param {BookingContext} bookingContext The booking it is closed for
   * @returns {Promise<void>}
   * @throws {Error} The provider's own error when the close did not go
   *   through
   */
  async close(accessPoint, bookingContext) {
    throw new Error(`close() is not supported by ${this.constructor.name}`);
  }

  /**
   * Pulls the latch so the door physically opens, instead of only releasing
   * the lock. Where a lock can pull its latch, {@link AccessProvider#open}
   * does so by itself; this is the older way to the same end.
   *
   * @param {Object} accessPoint The access point to unlatch
   * @param {BookingContext} bookingContext The booking it is unlatched for
   * @returns {Promise<OpenOutcome>} What the unlatch did
   * @throws {AccessOpenError} As of {@link AccessProvider#open}
   */
  async unlatch(accessPoint, bookingContext) {
    throw new Error(`unlatch() is not supported by ${this.constructor.name}`);
  }

  /**
   * The state of the lock right now.
   *
   * @param {Object} accessPoint The access point to read
   * @param {BookingContext} bookingContext The booking it is read for
   * @returns {Promise<LockStatus>} The state, `null` for whatever the
   *   provider does not report
   * @throws {Error} The provider's own error when the lock cannot be read
   */
  async getStatus(accessPoint, bookingContext) {
    throw new Error(`getStatus() is not supported by ${this.constructor.name}`);
  }

  /**
   * How far a pending open has come - only providers whose open answers
   * `pending` declare this.
   *
   * @param {Object} accessPoint The access point that was opened
   * @param {string} openProcessId The process the open answered with
   * @returns {Promise<OpenProgress>} The progress; a failed poll is answered,
   *   not thrown, with `confirmed: null` and the provider's reason
   */
  async getOpenProgress(accessPoint, openProcessId) {
    throw new Error(
      `getOpenProgress() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Grants the booking an authorization at the lock - a keypad code, a
   * guest with a PIN - for its access window.
   *
   * @param {Object} accessPoint The access point to grant access to
   * @param {BookingContext} bookingContext The booking that gets access;
   *   `pin` is used when it brings one
   * @returns {Promise<Object>} The grant, with at least `authorizationId`
   *   and the `pin` the person at the door types
   * @throws {Error} The provider's own error; the service rethrows it and
   *   the provisioning job tries again
   */
  async grantAuthorization(accessPoint, bookingContext) {
    throw new Error(
      `grantAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Takes the authorization back. A grant the provider no longer has is
   * nothing to do, not a failure.
   *
   * @param {Object} accessPoint The access point the grant was made for
   * @param {BookingContext} bookingContext The booking, with the
   *   `authorizationId` to revoke
   * @returns {Promise<Object>} The revocation
   * @throws {Error} The provider's own error when the revoke did not go
   *   through
   */
  async revokeAuthorization(accessPoint, bookingContext) {
    throw new Error(
      `revokeAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Every access point the provider has for the tenant.
   *
   * @param {string} tenant Tenant to list for
   * @returns {Promise<ListedAccessPoint[]>} The access points
   * @throws {Error} The provider's own error when the listing fails
   */
  async listAccessPoints(tenant) {
    throw new Error(
      `listAccessPoints() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * The access point modes the lock really supports right now, as
   * {@link AccessProvider#listAccessPoints} would list them.
   *
   * @param {Object} accessPoint The access point to ask about
   * @param {string} tenant Tenant the access point belongs to
   * @returns {Promise<string[]|null>} The modes, or `null` when the provider
   *   does not list the access point
   * @throws {Error} The provider's own error when the lock cannot be read
   */
  async getSupportedModes(accessPoint, tenant) {
    throw new Error(
      `getSupportedModes() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Where the physical lock stands, as far as the provider knows it. Optional
   * capability: only providers that declare `getLocation` are asked, and even
   * they may answer `null`. The result is a prefill suggestion - it is never
   * written to the access point by the provider.
   *
   * @param {Object} _accessPoint The access point to locate
   * @param {string} _tenant Tenant the access point belongs to
   * @returns {Promise<Object|null>} A `location` in the shape of
   *   `accessPoint.location`, or `null` when the provider knows no location
   * @throws {Error} The provider's own error when the lock cannot be read
   */
  async getLocation(_accessPoint, _tenant) {
    throw new Error(
      `getLocation() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Subscribes the tenant's account to events at the given URL.
   *
   * @param {string} tenant Tenant to subscribe for
   * @param {string} callbackUrl Where the provider is to send events
   * @returns {Promise<Object>} The provider's subscription record, whose
   *   `id` is what {@link AccessProvider#unregisterWebhook} takes
   * @throws {Error} The provider's own error when subscribing fails
   */
  async registerWebhook(tenant, callbackUrl) {
    throw new Error(
      `registerWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Ends a subscription. Without an id there is nothing to end.
   *
   * @param {string} tenant Tenant the subscription belongs to
   * @param {string|null} id The subscription as
   *   {@link AccessProvider#registerWebhook} answered it
   * @returns {Promise<Object>} The provider's answer
   * @throws {Error} The provider's own error when unsubscribing fails
   */
  async unregisterWebhook(tenant, id) {
    throw new Error(
      `unregisterWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Reads an incoming event into the shape the service routes on.
   *
   * @param {string|Object} _rawPayload The request body, raw or parsed
   * @param {Object} _headers The request headers
   * @returns {WebhookEvent} The event
   * @throws {SyntaxError} A raw body that is not JSON
   */
  parseWebhook(_rawPayload, _headers) {
    throw new Error(
      `parseWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * Whether an incoming event really comes from the provider. Without a
   * secret configured there is nothing to check against, and the event
   * passes.
   *
   * @param {string|Object} _rawPayload The request body, raw or parsed
   * @param {Object} _headers The request headers carrying the signature
   * @param {string|null} _secret The shared secret of the subscription
   * @returns {boolean} Whether the signature holds
   */
  verifyWebhookSignature(_rawPayload, _headers, _secret) {
    throw new Error(
      `verifyWebhookSignature() is not supported by ${this.constructor.name}`,
    );
  }

  /**
   * The methods this provider honours. The service asks nothing it does not
   * find here.
   *
   * @returns {string[]}
   */
  static get capabilities() {
    return [];
  }
}

module.exports = AccessProvider;
