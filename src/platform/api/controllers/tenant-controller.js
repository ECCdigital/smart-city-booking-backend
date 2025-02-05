const TenantManager = require("../../../commons/data-managers/tenant-manager");
const Tenant = require("../../../commons/entities/tenant");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");
const { readFileSync } = require("fs");
const { join } = require("path");

const logger = bunyan.createLogger({
  name: "tenant-controller.js",
  level: process.env.LOG_LEVEL,
});

class TenantPermissions {
  static _isOwner(affectedTenant, userId) {
    return affectedTenant.ownerUserIds.includes(userId);
  }

  static async _allowCreate(affectedTenant, userId) {
    return true;
  }

  static async _allowRead(affectedTenant, userId) {
    // A user is allowed to read a tenant if the marked as owner or has any kind of permissions in the tenant
    const permissions = await UserManager.getUserPermissions(userId);
    return (
      TenantPermissions._isOwner(affectedTenant, userId) ||
      permissions.some((p) => p.tenantId === affectedTenant.id)
    );
  }

  static async _allowUpdate(affectedTenant, userId) {
    return TenantPermissions._isOwner();
  }

  static async _allowDelete(affectedTenant, userId) {
    return TenantPermissions._isOwner(affectedTenant, userId);
  }
}

/**
 * Web Controller for Bookables.
 */
class TenantController {
  static async getTenants(request, response) {
    try {
      const { user } = request;

      const permissions = await UserManager.getUserPermissions(user.id);
      const tenantIds = permissions.map((p) => p.tenantId);

      const allowedTenants = [];
      for (const tenantId of tenantIds) {
        const tenant = await TenantManager.getTenant(tenantId);
        allowedTenants.push(tenant);
      }

      response.status(200).send(allowedTenants);
    } catch (error) {
      logger.error(error);
      response.sendStatus(500);
    }
  }

  static async getTenant(request, response) {
    try {
      const user = request.user;
      const id = request.params.id;

      if (id) {
        const tenant = await TenantManager.getTenant(id);

        if (user && (await TenantPermissions._allowRead(tenant, user.id))) {
          logger.info(
            `Sending tenant ${tenant.id} to user ${user?.id} with details`,
          );
          response.status(200).send(tenant);
        } else {
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `Could not get tenants by user ${user?.id}. Missing required parameters.`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get tenant");
    }
  }

  static async storeTenant(request, response) {
    const tenant = new Tenant(request.body);
    let isUpdate = false;

    try {
      const existingTenant = await TenantManager.getTenant(tenant.id);
      isUpdate = existingTenant && existingTenant._id;
    } catch (error) {
      logger.error(error);
      isUpdate = false;
    }

    if (isUpdate) {
      await TenantController.updateTenant(request, response);
    } else {
      await TenantController.createTenant(request, response);
    }
  }

  static async createTenant(request, response) {
    try {
      const user = request.user;
      const tenant = new Tenant(request.body);

      tenant.ownerUserId = user.id;

      if ((await TenantManager.checkTenantCount()) === false) {
        throw new Error(`Maximum number of tenants reached.`);
      }

      if (await TenantPermissions._allowCreate(tenant, user.id)) {
        if (!tenant.ownerUserIds.includes(user.id)) {
          tenant.ownerUserIds.push(user.id);
        }

        const emailTemplate = readFileSync(
          join(
            __dirname,
            "../../../commons/mail-service/templates/default-generic-mail-template.temp.html",
          ),
          "utf8",
        );
        const receiptTemplate = readFileSync(
          join(
            __dirname,
            "../../../commons/pdf-service/templates/default-receipt-template.temp.html",
          ),
          "utf8",
        );

        tenant.genericMailTemplate = emailTemplate;
        tenant.receiptTemplate = receiptTemplate;

        await TenantManager.storeTenant(tenant);
        logger.info(`created tenant ${tenant.id} by user ${user?.id}`);

        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to create tenant`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not create tenant");
    }
  }

  static async updateTenant(request, response) {
    try {
      const user = request.user;
      const tenant = new Tenant(request.body);
      if (await TenantPermissions._allowUpdate(tenant, user.id)) {
        await TenantManager.storeTenant(tenant);
        logger.info(`updated tenant ${tenant.id} by user ${user?.id}`);
        response.sendStatus(200);
      } else {
        logger.warn(`User ${user?.id} not allowed to update tenant`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not update tenant");
    }
  }

  static async removeTenant(request, response) {
    try {
      const user = request.user;
      const id = request.params.id;

      const tenant = await TenantManager.getTenant(id);

      if (id) {
        if (await TenantPermissions._allowDelete(tenant, user.id)) {
          await TenantManager.removeTenant(id);
          logger.info(`removed tenant ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(`User ${user?.id} not allowed to remove tenant`);
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `Could not remove tenant by user ${user?.id}. Missing required parameters.`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not remove tenant");
    }
  }

  static async getActivePaymentApps(request, response) {
    try {
      const {
        params: { id: tenantId },
        user,
      } = request;

      const paymentApps = await TenantManager.getTenantAppByType(
        tenantId,
        "payment",
      );
      const filteredPaymentApps = paymentApps
        .filter((app) => app.active)
        .map((app) => ({
          id: app.id,
          title: app.title,
        }));

      logger.info(
        `${tenantId} -- sending ${paymentApps.length} payment apps to user ${user?.id}`,
      );
      response.status(200).send(filteredPaymentApps);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get payment apps");
    }
  }
  static async countCheck(request, response) {
    try {
      const isCreateAllowed = await TenantManager.checkTenantCount();
      response.status(200).send(isCreateAllowed);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not check if creation is possible");
    }
  }
}

module.exports = TenantController;
