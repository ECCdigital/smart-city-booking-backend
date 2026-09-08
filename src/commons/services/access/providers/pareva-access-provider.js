const AccessProvider = require("./access-provider");
const TenantManager = require("../../../data-managers/tenant-manager");
const { createClient } = require("../clients/access-client-registry");
const { NotFoundError } = require("../../../../errors/BaseError");

require("../clients");

const PROVIDER_ID = "pareva";
const APP_TYPE = "access";

/**
 * Pareva locker systems: an access point is a product of the tenant's
 * locker system, its `externalId` the Pareva product id (a 24-hex id, the
 * Produkt-ID an admin enters by hand), and a grant is a rental of one
 * compartment of that product. Pareva mails the access code to the person
 * itself, so the platform neither learns a secret nor opens anything: the
 * adapter grants and revokes, and declares no `open`, `getStatus` or `hold`
 * - the stored booking is the claim on a compartment until the payment.
 *
 * It lists no access points: what `GET /locker/{lockerId}/available` lists
 * are size codes, not products, so a listed entry could never be rented.
 * How many compartments of a product are free is asked live at checkout by
 * `ParevaCheckoutProvider`.
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
   * Starts a rental of one compartment of the product for the booking's time.
   * Pareva answers the process of the rental, which is the grant, and
   * mails the access code to the booking's address from the tenant's.
   *
   * @param {Object} accessPoint The product, its `externalId` the Pareva
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
        `Pareva answered the rental of product '${accessPoint.externalId}' without a processId`,
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
   * @param {Object} accessPoint The product the rental was made for
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

  static get capabilities() {
    return ["grantAuthorization", "revokeAuthorization"];
  }
}

module.exports = ParevaAccessProvider;
