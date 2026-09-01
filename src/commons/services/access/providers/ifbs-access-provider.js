const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../../locker/clients/locker-client-registry");
const IfbsApiError = require("../../locker/clients/ifbs-api-error");

const APP_TYPE = "locker";

class IfbsAccessProvider extends AccessProvider {
  /**
   * Creates an iFBS API client for the given tenant.
   * @private
   */
  async _getClient(tenant) {
    const tenantData = await TenantManager.getTenant(tenant);
    const rawApp = tenantData.applications.find(
      (a) => a.type === APP_TYPE && a.id === "ifbs" && a.active,
    );

    if (!rawApp) {
      throw new Error(
        `No active locker application 'ifbs' found for tenant '${tenant}'`,
      );
    }

    return createClient(rawApp);
  }

  async open(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const result = await client.openBox(bookingContext.externalBookingId);
    return {
      processId: result.Booking_ID,
      openProcessId: result.OpenBox_ID,
    };
  }

  async close(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const result = await client.closeBox(bookingContext.externalBookingId);
    return {
      success: true,
      state: "closed",
      providerResponse: result,
    };
  }

  async getStatus(accessPoint, bookingContext) {
    const client = await this._getClient(bookingContext.tenant);
    const usage = this._resolveUsageWindowStatus(bookingContext);

    if (bookingContext.lastOpenBoxId) {
      try {
        const result = await client.monitorOpenBox(
          bookingContext.lastOpenBoxId,
        );

        return {
          ...this._mapOpenBoxStatus(result, { includeReceived: true }),
          bookingId: bookingContext.externalBookingId,
          usageState: usage.usageState,
        };
      } catch (err) {
        if (!this._isOpenBoxProcessNotFound(err)) {
          throw err;
        }
      }
    }

    return usage;
  }

  async getOpenStatus(tenant, openBoxId) {
    const client = await this._getClient(tenant);

    try {
      const result = await client.waitForOpenBox(openBoxId, 30);
      return this._mapOpenBoxStatus(result);
    } catch (err) {
      return {
        ...this._mapOpenBoxStatus({
          OpenBox_ID: openBoxId,
          BoxControlConfirmed: "false",
        }),
        errorCode: err instanceof IfbsApiError ? err.errNo : null,
        errorMessage: err instanceof IfbsApiError ? err.errMsg : err.message,
      };
    }
  }

  /**
   * Maps iFBS monitorOpenBox / waitForOpenBox fields to access status.
   * The API confirms lock activation only — not whether the door is physically open.
   * @private
   */
  _mapOpenBoxStatus(result, { includeReceived = false } = {}) {
    const confirmed = result.BoxControlConfirmed === "true";
    const received = result.BoxControlReceived === "true";

    const status = {
      openProcessId: result.OpenBox_ID ?? null,
      confirmed,
      confirmedAt: result.BoxControlConfirmedDateTime || null,
      open: confirmed ? true : null,
      state: confirmed ? "open" : received ? "opening" : "pending",
    };

    if (includeReceived) {
      status.boxControlReceived = received;
      status.receivedAt = result.BoxControlReceivedDateTime || null;
    }

    if (result.WaitTime != null) {
      status.waitTime = result.WaitTime;
    }

    return status;
  }

  /**
   * Derives booking usage window state when no OpenBox process is available.
   * @private
   */
  _resolveUsageWindowStatus(bookingContext) {
    const now = Date.now();
    const accessFrom = bookingContext.accessFrom ?? bookingContext.timeBegin;
    const accessTo = bookingContext.accessTo ?? bookingContext.timeEnd;

    let usageState = "active";
    if (accessFrom != null && now < accessFrom) {
      usageState = "upcoming";
    } else if (accessTo != null && now > accessTo) {
      usageState = "expired";
    }

    return {
      bookingId: bookingContext.externalBookingId,
      usageState,
      accessFrom,
      accessTo,
      open: null,
      locked: null,
      doorOpen: null,
      state: usageState,
    };
  }

  /** @private */
  _isOpenBoxProcessNotFound(err) {
    return err instanceof IfbsApiError && [1802, 1902].includes(err.errNo);
  }

  static get capabilities() {
    return ["open", "close", "getStatus", "getOpenStatus"];
  }
}

module.exports = IfbsAccessProvider;
