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

  async getOpenStatus(tenant, openBoxId) {
    const client = await this._getClient(tenant);

    try {
      const result = await client.waitForOpenBox(openBoxId, 30);

      return {
        confirmed: result.BoxControlConfirmed === "true",
        confirmedAt: result.BoxControlConfirmedDateTime || null,
        waitTime: result.WaitTime || null,
        openProcessId: openBoxId || null,
      };
    } catch (err) {

      return {
        confirmed: false,
        confirmedAt: null,
        waitTime: null,
        openProcessId: openBoxId || null,
        errorCode: err instanceof IfbsApiError ? err.errNo : null,
        errorMessage: err instanceof IfbsApiError ? err.errMsg : err.message,
      };
    }
  }

  static get capabilities() {
    return ["open", "close", "getStatus"];
  }
}

module.exports = IfbsAccessProvider;
