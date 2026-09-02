const bunyan = require("bunyan");
const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const UserManager = require("../../../data-managers/user-manager");
const { createClient } = require("../../locker/clients/locker-client-registry");
const IfbsApiClient = require("../clients/ifbs-api-client");
const IfbsApiError = require("../clients/ifbs-api-error");
const {
  AccessCapability,
  AccessPointMode,
} = require("../../../entities/access/access-point");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");
const { NotFoundError } = require("../../../../errors/BaseError");

require("../../locker/clients");

const PROVIDER_ID = "ifbs";

// How long iFBS keeps a box after `getBox` before it releases it again.
const HOLD_TTL_MS = 2 * 60 * 1000;

const logger = bunyan.createLogger({
  name: "ifbs-access-provider.js",
  level: process.env.LOG_LEVEL,
});

/**
 * iFBS bike boxes: an access point is a location, and iFBS chooses the box
 * a booking gets. Before the payment the box is held (`getBox`, two
 * minutes, renewable); the grant confirms it (`bookIt`), the revoke gives
 * it back (`cancelUsage` before the usage began, `endUsage` after), and an
 * open hands the command to the box, which confirms later.
 */
class IfbsAccessProvider extends AccessProvider {
  /**
   * Creates an iFBS API client for the given tenant.
   * @private
   * @throws {NotFoundError} `ifbs_application_not_found` when the tenant
   *   has no active iFBS application
   */
  async _getClient(tenant) {
    if (this._client) {
      return this._client;
    }

    const tenantData = await TenantManager.getTenant(tenant);
    const rawApp = this._findActiveApplication(
      tenantData,
      PROVIDER_ID,
      AccessProvider.lockerApplicationTypes,
    );

    if (!rawApp) {
      throw new NotFoundError("ifbs_application_not_found", { tenant });
    }

    return createClient(rawApp);
  }

  /**
   * Hands the open command to the box. iFBS confirms the open later, so the
   * outcome is always `pending` with the `OpenBox_ID` to poll through
   * {@link IfbsAccessProvider#getOpenProgress}.
   *
   * @param {Object} accessPoint The locker to open
   * @param {Object} bookingContext The booking, with the iFBS
   *   `externalBookingId` the box was booked under
   * @returns {Promise<import("./access-provider").OpenOutcome>}
   * @throws {AccessOpenError} `configuration` without an active iFBS
   *   application; `temporary` for everything iFBS or the network did not
   *   manage, an iFBS error number included - the box is booked either
   *   way, so a refusal is nothing the admin can configure away
   */
  async open(accessPoint, bookingContext) {
    const client = await this._getClientForOpen(bookingContext.tenant);
    const bookingId = bookingContext.externalBookingId;

    let result;
    try {
      result = await client.openBox(bookingId);
    } catch (err) {
      throw err instanceof IfbsApiError
        ? AccessOpenError.temporary(
            `iFBS refused to open the box of booking '${bookingId}' (${err.errNo}): ${err.errMsg}`,
          )
        : AccessOpenError.temporary(
            `iFBS open of booking '${bookingId}' failed: ${err.message}`,
          );
    }

    if (result.OpenBox_ID == null) {
      throw AccessOpenError.temporary(
        `iFBS answered the open of booking '${bookingId}' without an OpenBox_ID`,
      );
    }

    return { state: "pending", openProcessId: String(result.OpenBox_ID) };
  }

  /**
   * Waits up to 30 seconds for the box to confirm the open. A poll that
   * fails - the process is unknown to iFBS, the API is unreachable - is
   * answered with `confirmed: null` and the reason, never thrown: the person
   * at the box keeps polling, and the reason is theirs to see.
   *
   * @param {Object} accessPoint The locker that was opened
   * @param {string} openProcessId The `OpenBox_ID` the open answered with
   * @returns {Promise<import("./access-provider").OpenProgress>}
   */
  async getOpenProgress(accessPoint, openProcessId) {
    try {
      const client = await this._getClient(accessPoint.tenantId);
      const result = await client.waitForOpenBox(openProcessId, 30);
      return {
        confirmed: result.BoxControlConfirmed === "true",
        confirmedAt: result.BoxControlConfirmedDateTime || null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (err) {
      return {
        confirmed: null,
        confirmedAt: null,
        errorCode: err instanceof IfbsApiError ? err.errNo : null,
        errorMessage: err instanceof IfbsApiError ? err.errMsg : err.message,
      };
    }
  }

  /**
   * Asks iFBS for a box at the location for the booking's time. iFBS
   * chooses the box and keeps it for two minutes; the hold carries its
   * `Booking_ID` to confirm by and the box number the person will look for.
   *
   * @param {Object} accessPoint The location, its `externalId` the iFBS
   *   `LocationID`
   * @param {Object} bookingContext The booking that claims a box
   * @returns {Promise<import("./access-provider").Hold>}
   * @throws {Error} iFBS' own error when it has no box left, or one of our
   *   own when it answers without a `Booking_ID`
   */
  async hold(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    // iFBS starts its two minutes when it hands the box out, not when the
    // answer arrives: the hold is dated from before the request.
    const heldAt = Date.now();
    const box = await client.getBox(
      accessPoint.externalId,
      IfbsApiClient.formatDate(bookingContext.timeBegin),
      IfbsApiClient.formatDate(bookingContext.timeEnd),
      await this._userId(bookingContext),
    );

    if (box.Booking_ID == null) {
      throw new Error(
        `iFBS answered no box at location '${accessPoint.externalId}'`,
      );
    }

    return {
      holdId: String(box.Booking_ID),
      expiresAt: heldAt + HOLD_TTL_MS,
      compartment: String(box.nummer),
    };
  }

  /**
   * Holds again: iFBS knows no renewal, so a fresh `getBox` replaces the
   * hold, and the box may be another one.
   *
   * @param {Object} accessPoint The location
   * @param {Object} bookingContext The booking, with the hold to renew
   * @returns {Promise<import("./access-provider").Hold>}
   */
  async refreshHold(accessPoint, bookingContext) {
    return this.hold(accessPoint, bookingContext);
  }

  /**
   * Confirms the held box with `bookIt`, proving the booking with the
   * checksum over box number, time and the tenant's secret phrase. A hold
   * that lapsed - or none at all - is replaced by a fresh `getBox` first.
   * The grant is the iFBS `Booking_ID`; iFBS keeps no principal and hands
   * out no secret - the box opens through the API.
   *
   * @param {Object} accessPoint The location
   * @param {Object} bookingContext The booking, with the `hold` to consume
   * @returns {Promise<import("./access-provider").Grant>}
   * @throws {Error} iFBS' own error when the confirmation is refused
   */
  async grantAuthorization(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const dateFrom = IfbsApiClient.formatDate(bookingContext.timeBegin);
    const dateTo = IfbsApiClient.formatDate(bookingContext.timeEnd);

    let hold = bookingContext.hold;
    if (!this._isHoldValid(hold)) {
      logger.info(
        `iFBS hold of booking ${bookingContext.bookingId} at location ${accessPoint.externalId} is ${hold?.holdId ? "expired" : "missing"}, taking a new box`,
      );
      hold = await this.hold(accessPoint, bookingContext);
    }

    const checksum = IfbsApiClient.checksum(
      hold.compartment,
      dateFrom,
      dateTo,
      client.secretPhrase,
    );
    const result = await client.bookIt(hold.holdId, checksum);

    return {
      authorizationId: String(result.Booking_ID ?? hold.holdId),
      externalPrincipalId: null,
      secret: null,
    };
  }

  /**
   * Gives the box back: `cancelUsage` before the usage began, `endUsage`
   * as of now after. The seam hands over no booking time, so the adapter
   * asks for the cancel first and ends the usage where iFBS refuses it -
   * on the assumption, taken from the locker stack this replaces, that
   * iFBS refuses to cancel a usage that has begun. A booking iFBS refuses
   * both for is taken as one it no longer has - nothing to do, not a
   * failure - which is what makes a repeated revoke harmless; the two
   * refusals are logged as a warning so a refusal for another reason (a
   * wrong key, say) does not pass unseen. Network failures are thrown.
   *
   * @param {Object} accessPoint The location the grant was made at
   * @param {import("./access-provider").Grant} grant The grant to revoke
   * @returns {Promise<import("./access-provider").Revocation>} Always with
   *   no principal to remove
   */
  async revokeAuthorization(accessPoint, grant) {
    const bookingId = grant?.authorizationId;

    if (!bookingId) {
      return { principalRemoved: null };
    }

    const client = await this._getClient(accessPoint.tenantId);

    let cancelRefusal;
    try {
      await client.cancelUsage(bookingId);
      return { principalRemoved: null };
    } catch (err) {
      if (!(err instanceof IfbsApiError)) {
        throw err;
      }
      cancelRefusal = err;
    }

    try {
      await client.endUsage(bookingId, IfbsApiClient.formatDate(Date.now()));
    } catch (err) {
      if (!(err instanceof IfbsApiError)) {
        throw err;
      }
      logger.warn(
        `iFBS neither cancels (${cancelRefusal.errNo}: ${cancelRefusal.errMsg}) nor ends (${err.errNo}: ${err.errMsg}) booking '${bookingId}' - taking it as already given back`,
      );
    }

    return { principalRemoved: null };
  }

  /**
   * The locations iFBS lists for the tenant, each a locker system whose
   * compartments iFBS hands out. `LocationID` is all the listing is known
   * to carry; a name is read where the listing has one.
   *
   * @param {string} tenant Tenant to list for
   * @returns {Promise<import("./access-provider").ListedAccessPoint[]>}
   */
  async listAccessPoints(tenant) {
    const client = await this._getClient(tenant);
    const cities = await client.getLocations();

    return cities
      .flatMap((city) => city.locations || [])
      .map((location) => {
        const locationId = String(location.LocationID);

        return {
          id: locationId,
          type: "locker",
          provider: PROVIDER_ID,
          externalId: locationId,
          locationId,
          label: String(location.Name || location.LocationName || locationId),
          capabilities: [AccessCapability.REMOTE],
          supportedModes: [AccessPointMode.REMOTE],
          metadata: location,
        };
      });
  }

  /** @private */
  _isHoldValid(hold) {
    return Boolean(
      hold?.holdId &&
        hold.compartment != null &&
        (hold.expiresAt == null || hold.expiresAt > Date.now()),
    );
  }

  /**
   * @private
   * The `User_ID` iFBS is told on `getBox`, for the booking's user where
   * the platform knows one.
   */
  async _userId(bookingContext) {
    const assignedUserId = bookingContext.booking?.assignedUserId;
    const rawUser = assignedUserId
      ? await UserManager.getRawUser(assignedUserId)
      : null;

    return IfbsApiClient.userId(rawUser);
  }

  static get capabilities() {
    // No close: iFBS has no command to close a box - the door of a locker
    // is shut by hand. No getStatus: without an open process iFBS knows
    // nothing about a box, and the process is polled through
    // getOpenProgress.
    return [
      "open",
      "getOpenProgress",
      "hold",
      "refreshHold",
      "grantAuthorization",
      "revokeAuthorization",
      "listAccessPoints",
    ];
  }
}

module.exports = IfbsAccessProvider;
