const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../clients/access-client-registry");
const {
  AccessCapability,
  AccessPointMode,
} = require("../../../entities/access/access-point");
const { NotFoundError } = require("../../../../errors/BaseError");

require("../clients");

const PROVIDER_ID = "pareva";
const APP_TYPE = "access";

/**
 * Pareva locker systems: an access point is a size (product) of the
 * tenant's locker system, and a grant is a rental of one compartment of
 * that size. Pareva mails the access code to the person itself, so the
 * platform neither learns a secret nor opens anything: the adapter grants,
 * revokes and lists, and declares no `open`, `getStatus` or `hold` - the
 * stored booking is the claim on a compartment until the payment.
 */
class ParevaAccessProvider extends AccessProvider {
  /**
   * Creates a Pareva API client for the given tenant.
   * @private
   * @param {string} tenant Tenant the client acts for
   * @param {Object|null} [tenantData] The tenant where the caller has read
   *   it already, so it is not read twice
   * @throws {NotFoundError} `pareva_application_not_found` when the tenant
   *   has no active Pareva application
   */
  async _getClient(tenant, tenantData = null) {
    if (this._client) {
      return this._client;
    }

    const rawApp = this._findActiveApplication(
      tenantData || (await TenantManager.getTenant(tenant)),
      PROVIDER_ID,
      [APP_TYPE],
    );

    if (!rawApp) {
      throw new NotFoundError("pareva_application_not_found", { tenant });
    }

    return createClient(rawApp);
  }

  /**
   * Starts a rental of one compartment of the size for the booking's time.
   * Pareva answers the process of the rental, which is the grant, and
   * mails the access code to the booking's address from the tenant's.
   *
   * @param {Object} accessPoint The size, its `externalId` the Pareva
   *   product id
   * @param {Object} bookingContext The booking that rents; `booking.mail`
   *   is where Pareva sends the code
   * @returns {Promise<import("./access-provider").Grant>} The grant, with
   *   no principal and no secret - Pareva keeps both
   * @throws {Error} Pareva's own error, or one of our own when the answer
   *   carries no `processId`
   */
  async grantAuthorization(accessPoint, bookingContext) {
    const tenantData = await TenantManager.getTenant(bookingContext.tenant);
    const client = await this._getClient(bookingContext.tenant, tenantData);

    const rental = await client.startRental(accessPoint.externalId, {
      email: bookingContext.booking?.mail,
      fromEmail: tenantData?.mail,
      plannedBegin: bookingContext.timeBegin,
      plannedEnd: bookingContext.timeEnd,
    });

    if (rental?.processId == null) {
      throw new Error(
        `Pareva answered the rental of size '${accessPoint.externalId}' without a processId`,
      );
    }

    return {
      authorizationId: String(rental.processId),
      externalPrincipalId: null,
      secret: null,
    };
  }

  /**
   * Cancels the rental. A process Pareva no longer knows (404) is nothing
   * to do; a cancel Pareva refuses is thrown, since the person keeps the
   * compartment then and the failure has to be seen.
   *
   * @param {Object} accessPoint The size the rental was made for
   * @param {import("./access-provider").Grant} grant The grant to revoke
   * @returns {Promise<import("./access-provider").Revocation>} Always with
   *   no principal to remove
   * @throws {Error} Pareva's own error, or one of our own when Pareva
   *   answers the cancel without `success`
   */
  async revokeAuthorization(accessPoint, grant) {
    const processId = grant?.authorizationId;

    if (!processId) {
      return { principalRemoved: null };
    }

    const client = await this._getClient(accessPoint.tenantId);

    let answer;
    try {
      answer = await client.cancelRental(processId);
    } catch (err) {
      if (err?.response?.status === 404) {
        return { principalRemoved: null };
      }
      throw err;
    }

    if (answer?.success !== true) {
      throw new Error(
        `Pareva refused to cancel rental '${processId}': ${answer?.reason || "no reason given"}`,
      );
    }

    return { principalRemoved: null };
  }

  /**
   * The sizes the tenant's locker system offers, one access point each.
   * The locker system itself is the location they share.
   *
   * @param {string} tenant Tenant to list for
   * @returns {Promise<import("./access-provider").ListedAccessPoint[]>}
   */
  async listAccessPoints(tenant) {
    const client = await this._getClient(tenant);
    const sizes = await client.listSizes();

    return sizes.map((size) => {
      const sizeId = String(size.size);

      return {
        id: sizeId,
        type: "locker",
        provider: PROVIDER_ID,
        externalId: sizeId,
        locationId: client.lockerId != null ? String(client.lockerId) : null,
        label: String(size.name || sizeId),
        capabilities: [AccessCapability.AUTHORIZATION],
        supportedModes: [AccessPointMode.AUTHORIZATION],
        metadata: size,
      };
    });
  }

  static get capabilities() {
    return ["grantAuthorization", "revokeAuthorization", "listAccessPoints"];
  }
}

module.exports = ParevaAccessProvider;
