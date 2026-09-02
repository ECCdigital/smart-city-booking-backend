const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../../locker/clients/locker-client-registry");
const IfbsApiError = require("../../locker/clients/ifbs-api-error");
const { AccessOpenError } = require("../../../../errors/AccessOpenError");
const { NotFoundError } = require("../../../../errors/BaseError");

const APP_TYPE = "locker";

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
    const rawApp = tenantData?.applications?.find(
      (a) => a.type === APP_TYPE && a.id === "ifbs" && a.active,
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
   * What iFBS knows about the box: only whether the last open process it
   * has for the booking was confirmed. iFBS confirms lock activation, not
   * whether the door is physically open, and without a known process it
   * knows nothing at all.
   *
   * @param {Object} accessPoint The locker to read
   * @param {Object} bookingContext The booking, with `lastOpenBoxId` where
   *   an open process is known
   * @returns {Promise<import("./access-provider").LockStatus>}
   */
  async getStatus(accessPoint, bookingContext) {
    const unknown = AccessProvider.unknownLockStatus;

    if (!bookingContext.lastOpenBoxId) {
      return unknown;
    }

    const client = await this._getClient(bookingContext.tenant);

    try {
      const result = await client.monitorOpenBox(bookingContext.lastOpenBoxId);

      return result.BoxControlConfirmed === "true"
        ? { open: true, locked: false, doorOpen: null }
        : unknown;
    } catch (err) {
      if (this._isOpenBoxProcessNotFound(err)) {
        return unknown;
      }
      throw err;
    }
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

  /** @private */
  _isOpenBoxProcessNotFound(err) {
    return err instanceof IfbsApiError && [1802, 1902].includes(err.errNo);
  }

  static get capabilities() {
    // No close: iFBS has no command to close a box - the door of a locker
    // is shut by hand.
    return ["open", "getStatus", "getOpenProgress"];
  }
}

module.exports = IfbsAccessProvider;
