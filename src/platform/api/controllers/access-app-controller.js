const bunyan = require("bunyan");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionService = require("../../../commons/services/permission-service");
const AccessInfoService = require("../../../commons/services/access/access-info-service");
const {
  hasTestHandler,
} = require("../../../commons/services/access/clients/access-test-registry");

const logger = bunyan.createLogger({
  name: "access-app-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessAppController {
  static async getProviders(request, response) {
    try {
      const { tenant } = request.params;
      const user = request.user;

      if (!(await AccessAppController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const providers = await AccessInfoService.getActiveProviders(tenant);
      return response.status(200).send(providers);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get access providers");
    }
  }

  static async getAccessPoints(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

      if (!(await AccessAppController._canRead(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const points = await AccessInfoService.getAccessPoints(tenant, provider);
      return response.status(200).send(points);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get access points");
    }
  }

  static async testConnection(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

      if (!(await AccessAppController._canManageTenants(user.id, tenant))) {
        return response.sendStatus(403);
      }

      if (!hasTestHandler(provider)) {
        return response
          .status(400)
          .send(`No test available for provider: ${provider}`);
      }

      const result = await AccessInfoService.testConnection(
        provider,
        request.body,
      );
      logger.info(
        `${tenant} -- ${provider} access connection test by user ${user?.id}: ${result.success}`,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not test access connection");
    }
  }

  static async registerWebhook(request, response) {
    try {
      const { tenant, provider } = request.params;
      const { callbackUrl } = request.body;
      const user = request.user;

      if (!(await AccessAppController._canManageTenants(user.id, tenant))) {
        return response.sendStatus(403);
      }

      if (!callbackUrl) {
        return response.status(400).send("Missing callbackUrl");
      }

      const result = await AccessInfoService.registerWebhook(
        tenant,
        provider,
        callbackUrl,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not register access webhook");
    }
  }

  static async unregisterWebhook(request, response) {
    try {
      const { tenant, provider } = request.params;
      const { notificationId } = request.body;
      const user = request.user;

      if (!(await AccessAppController._canManageTenants(user.id, tenant))) {
        return response.sendStatus(403);
      }

      const result = await AccessInfoService.unregisterWebhook(
        tenant,
        provider,
        notificationId,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not unregister access webhook");
    }
  }

  static async _canRead(userId, tenant) {
    return PermissionService._allowReadAny(
      userId,
      tenant,
      RolePermission.MANAGE_BOOKABLES,
    );
  }

  static async _canManageTenants(userId, tenant) {
    return PermissionService._allowUpdateAny(
      userId,
      tenant,
      RolePermission.MANAGE_TENANTS,
    );
  }
}

module.exports = AccessAppController;
