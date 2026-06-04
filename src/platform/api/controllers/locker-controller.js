const bunyan = require("bunyan");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionService = require("../../../commons/services/permission-service");
const LockerInfoService = require("../../../commons/services/locker/locker-info-service");

const logger = bunyan.createLogger({
  name: "locker-controller.js",
  level: process.env.LOG_LEVEL,
});

class LockerController {
  /**
   * POST /:tenant/locker/:provider/test
   * Body: { serverUrl, apiKeyID, apiKey }
   *
   * Tests the connection to the locker provider API
   * without persisting any configuration.
   */
  static async testConnection(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

      if (
        !(await LockerController._canRead(user.id, tenant)) &&
        (await PermissionService._allowUpdateAny(
          user.id,
          tenant,
          RolePermission.MANAGE_TENANTS,
        ))
      ) {
        return response.sendStatus(403);
      }

      const {
        hasTestHandler,
      } = require("../../../commons/services/locker/clients/locker-test-registry");

      if (!hasTestHandler(provider)) {
        return response
          .status(400)
          .send(`No test available for provider: ${provider}`);
      }

      const config = request.body;

      const {
        testProvider,
      } = require("../../../commons/services/locker/clients/locker-test-registry");

      const result = await testProvider(provider, config);

      logger.info(
        `${tenant} -- ${provider} connection test by user ${user?.id}: ${result.success}`,
      );

      console.log(
        `Locker connection test result for tenant ${tenant}, provider ${provider}:`,
        result,
      );

      response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not test locker connection");
    }
  }
  /**
   * GET /:tenant/locker/providers
   * Returns all active locker providers with their capabilities.
   */
  static async getProviders(request, response) {
    try {
      const { tenant } = request.params;
      const user = request.user;

      if (!(await LockerController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const providers = await LockerInfoService.getActiveProviders(tenant);

      logger.info(
        `${tenant} -- sending ${providers.length} providers to user ${user?.id}`,
      );
      response.status(200).send(providers);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker providers");
    }
  }

  /**
   * GET /:tenant/locker/:provider/locations
   */
  static async getLocations(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

      if (!(await LockerController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const locations = await LockerInfoService.getLocations(tenant, provider);

      logger.info(
        `${tenant} -- sending ${provider} locations to user ${user?.id}`,
      );
      response.status(200).send(locations);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker locations");
    }
  }

  /**
   * GET /:tenant/locker/:provider/locations/stats
   */
  static async getLocationsStat(request, response) {
    try {
      const { tenant, provider, locationId } = request.params;
      const user = request.user;

      if (!(await LockerController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const stats = await LockerInfoService.getLocationsStat(
        tenant,
        provider,
        locationId,
      );

      logger.info(
        `${tenant} -- sending ${provider} location stats to user ${user?.id}`,
      );
      response.status(200).send(stats);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker location stats");
    }
  }

  /**
   * GET /:tenant/locker/:provider/locations/:locationId
   */
  static async getLocationById(request, response) {
    try {
      const { tenant, provider, locationId } = request.params;
      const user = request.user;

      if (!locationId) {
        return response.status(400).send("Missing locationId");
      }

      if (!(await LockerController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const location = await LockerInfoService.getLocationById(
        tenant,
        provider,
        locationId,
      );

      if (!location) {
        return response.status(404).send("Location not found");
      }

      logger.info(
        `${tenant} -- sending ${provider} location ${locationId} to user ${user?.id}`,
      );
      response.status(200).send(location);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker location");
    }
  }

  /**
   * GET /:tenant/locker/:provider/locations/:locationId/price
   */
  static async getPrice(request, response) {
    try {
      const { tenant, provider, locationId } = request.params;
      const user = request.user;

      if (!locationId) {
        return response.status(400).send("Missing locationId");
      }

      if (!(await LockerController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const pricing = await LockerInfoService.getPrice(
        tenant,
        provider,
        locationId,
      );

      logger.info(
        `${tenant} -- sending ${provider} pricing for location ${locationId} to user ${user?.id}`,
      );
      response.status(200).send(pricing);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker pricing");
    }
  }

  static async getCustomerServiceInfo(request, response) {
    try {
      const { tenant, provider } = request.params;

      const info = await LockerInfoService.getCustomerServiceInfo(
        tenant,
        provider,
      );

      logger.info(
        `${tenant} -- sending ${provider} customer service info`,
      );
      response.status(200).send(info);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get locker customer service info");
    }
  }

  /**
   * Shared permission check
   * @private
   */
  static async _canRead(userId, tenant) {
    return PermissionService._allowReadAny(
      userId,
      tenant,
      RolePermission.MANAGE_BOOKABLES,
    );
  }
}

module.exports = LockerController;
