const TenantManager = require("../../../commons/data-managers/tenant-manager");
const Tenant = require("../../../commons/entities/tenant");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");
const { readFileSync } = require("fs");
const { join } = require("path");
const { parseBoolean } = require("../../../commons/utilities/parser");

const logger = bunyan.createLogger({
  name: "tenant-controller.js",
  level: process.env.LOG_LEVEL,
});

class TenantPermissions {
  static _isOwner(affectedTenant, userId, userTenant) {
    return (
      affectedTenant.ownerUserId === userId && affectedTenant.id === userTenant
    );
  }

  static async _allowCreate(affectedTenant, userId, userTenant) {
    return await UserManager.hasPermission(
      userId,
      userTenant,
      RolePermission.MANAGE_TENANTS,
      "create",
    );
  }

  static async _allowRead(affectedTenant, userId, userTenant) {
    if (
      await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "readAny",
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "readOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(affectedTenant, userId, userTenant) {
    if (
      await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "updateAny",
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "updateOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(affectedTenant, userId, userTenant) {
    if (
      await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "deleteAny",
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "deleteOwn",
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Bookables.
 */
class TenantController {
  static async getTenants(request, response) {
    try {
      const {
        user,
        query: { publicTenants = "false" },
      } = request;
      const isPublicTenants = parseBoolean(publicTenants);
      const tenants = await TenantManager.getTenants();
      const isAuthenticated = request.isAuthenticated();

      if (isAuthenticated && user && !isPublicTenants) {
        const checkPermissions = tenants.map((tenant) =>
          TenantPermissions._allowRead(tenant, user.id, user.tenant).then(
            (allowed) => (allowed ? tenant : null),
          ),
        );
        const results = await Promise.all(checkPermissions);
        const allowedTenants = results.filter((tenant) => tenant !== null);

        logger.info(
          `Sending ${allowedTenants.length} allowed tenants to user ${user.id} (incl. details)`,
        );
        response.status(200).send(allowedTenants);
      } else {
        const publicTenants = tenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          contactName: tenant.contactName,
          location: tenant.location,
          mail: tenant.mail,
          phone: tenant.phone,
        }));

        logger.info(
          `Sending ${publicTenants.length} public tenants to anonymous user`,
        );
        response.status(200).send(publicTenants);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get tenants");
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
          (await TenantPermissions._allowRead(tenant, user.id, user.tenant))
        ) {
          logger.info(
            `Sending tenant ${tenant.id} to user ${user?.id} with details`,
          );
          response.status(200).send(tenant);
        } else {
          logger.info(
            `sending tenant ${tenant.id} to user ${user?.id} without details`,
          );
          response.status(200).send({
            id: tenant.id,
            name: tenant.name,
            contactName: tenant.contactName,
            location: tenant.location,
            mail: tenant.mail,
            phone: tenant.phone,
            website: tenant.website,
          });
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
    const tenant = Object.assign(new Tenant(), request.body);
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
      const tenant = Object.assign(new Tenant(), request.body);

      tenant.ownerUserId = user.id;

      if (await TenantPermissions._allowCreate(tenant, user.id, user.tenant)) {
        const tenantAdmin = Object.assign(new Object(), user);
        tenantAdmin.tenant = tenant.id;
        tenantAdmin.roles = ["super-admin"];
        await UserManager.storeUser(tenantAdmin);

        logger.info(
          `created tenant admin ${tenantAdmin.id} for new tenant ${tenant.id}`,
        );

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
      const tenant = Object.assign(new Tenant(), request.body);
      if (await TenantPermissions._allowUpdate(tenant, user.id, user.tenant)) {
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
          await TenantPermissions._allowDelete(tenant, user.id, user.tenant)
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
}

module.exports = TenantController;
