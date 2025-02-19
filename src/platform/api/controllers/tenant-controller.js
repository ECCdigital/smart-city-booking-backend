const TenantManager = require("../../../commons/data-managers/tenant-manager");
const Tenant = require("../../../commons/entities/tenant");
const UserManager = require("../../../commons/data-managers/user-manager");
const PermissionService = require("../../../commons/services/permission-service");
const InstanceManger = require("../../../commons/data-managers/instance-manager");
const bunyan = require("bunyan");
const { readFileSync } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");

const logger = bunyan.createLogger({
  name: "tenant-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Bookables.
 */
class TenantController {
  static async getTenants(request, response) {
    try {
      const { user } = request;
      const publicTenants = request.query.publicTenants === "true";
      const permissions = await UserManager.getUserPermissions(user.id);
      const tenantIds = permissions.tenants.map((p) => p.tenantId);

      const tenants = await TenantManager.getTenants();

      const allowedTenants = [];
      for (const tenant of tenants) {
        if (publicTenants) {
          tenant.removePrivateData();
          if (tenantIds.includes(tenant.id)) {
            allowedTenants.push(tenant);
          }
        } else if (
          (await PermissionService._isTenantOwner(user.id, tenant.id)) ||
          (await PermissionService._isInstanceOwner(user.id))
        ) {
          allowedTenants.push(tenant);
        }
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

        if (
          user &&
          (await PermissionService._isTenantOwner(user.id, tenant.id))
        ) {
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
    let isUpdate;

    try {
      const existingTenant = await TenantManager.getTenant(tenant.id);
      isUpdate = !!(existingTenant && existingTenant.id);
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
      tenant.id = uuidv4();

      tenant.ownerUserId = user.id;

      if ((await TenantManager.checkTenantCount()) === false) {
        throw new Error(`Maximum number of tenants reached.`);
      }

      const instance = await InstanceManger.getInstance();

      const hasPermission =
        instance.allowAllUsersToCreateTenant ||
        instance.allowedUsersToCreateTenant.includes(user.id);

      console.log("hasPermission", hasPermission);

      if (hasPermission) {
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
      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
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
        if (
          (await PermissionService._isTenantOwner(user.id, tenant.id)) ||
          (await PermissionService._isInstanceOwner(user.id))
        ) {
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

  static async addUser(request, response) {
    try {
      const tenantId = request.params.id;
      const body = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
        if (
          tenant.users.some(
            (userReference) => userReference.userId === body.userId,
          )
        ) {
          tenant.users
            .filter((userReference) => userReference.userId === body.userId)
            .forEach(
              (user) =>
                (user.roles = [...new Set([...user.roles, ...body.roles])]),
            );
        } else {
          tenant.users.push({
            userId: body.userId,
            roles: [...new Set(body.roles)],
          });
        }

        const updatedTenant = await TenantManager.storeTenant(tenant);

        response.status(201).send(updatedTenant);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not add user to tenant");
    }
  }

  static async removeUser(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
        tenant.users = tenant.users.filter(
          (userRef) => userRef.userId !== userId,
        );

        tenant.ownerUserIds = tenant.ownerUserIds.filter((u) => u !== userId);

        if (tenant.ownerUserIds.length === 0) {
          throw new Error("Cannot remove last owner from tenant");
        }

        const updatedTenant = await TenantManager.storeTenant(tenant);

        response.status(200).send(updatedTenant);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async removeUserRole(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId, roleId } = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);
      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
        const userRef = tenant.users.find(
          (userRef) => userRef.userId === userId,
        );
        userRef.roles = userRef.roles.filter((r) => r !== roleId);

        const updatedTenant = await TenantManager.storeTenant(tenant);

        response.status(200).send(updatedTenant);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async addOwner(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
        if (!tenant.ownerUserIds.includes(userId)) {
          tenant.ownerUserIds.push(userId);
        }

        const updatedTenant = await TenantManager.storeTenant(tenant);

        response.status(200).send(updatedTenant);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not add owner to tenant");
    }
  }

  static async removeOwner(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (await PermissionService._isTenantOwner(user.id, tenant.id)) {
        tenant.ownerUserIds = tenant.ownerUserIds.filter(
          (uid) => uid !== userId,
        );

        if (tenant.ownerUserIds.length === 0) {
          throw new Error("Cannot remove last owner from tenant");
        }

        const updatedTenant = await TenantManager.storeTenant(tenant);

        response.status(200).send(updatedTenant);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove owner from tenant");
    }
  }
}

module.exports = { TenantController };
