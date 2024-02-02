const RoleManager = require("../../../commons/data-managers/role-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const { Bookable } = require("../../../commons/entities/bookable");
const Tenant = require("../../../commons/entities/tenant");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");

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
      "create"
    );
  }

  static async _allowRead(affectedTenant, userId, userTenant) {
    if (
      await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "readAny"
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "readOwn"
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
        "updateAny"
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "updateOwn"
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
        "deleteAny"
      )
    )
      return true;

    if (
      TenantPermissions._isOwner(affectedTenant, userId, userTenant) &&
      (await UserManager.hasPermission(
        userId,
        userTenant,
        RolePermission.MANAGE_TENANTS,
        "deleteOwn"
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
    const user = request.user;
    const tenants = await TenantManager.getTenants();

    if (!!user) {
      let allowedTenants = [];
      for (let tenant of tenants) {
        if (await TenantPermissions._allowRead(tenant, user.id, user.tenant)) {
          allowedTenants.push(tenant);
        }
      }

      response.status(200).send(allowedTenants);
    } else {
      response.status(200).send(
        tenants.map((t) => {
          return {
            id: t.id,
            name: t.name,
            contactName: t.contactName,
            location: t.location,
            mail: t.mail,
            phone: t.phone,
          };
        })
      );
    }
  }

  static async getTenant(request, response) {
    const user = request.user;
    const id = request.params.id;

    if (id) {
      const tenant = await TenantManager.getTenant(id);

      if (await TenantPermissions._allowRead(tenant, user.id, user.tenant)) {
        response.status(200).send(tenant);
      } else {
        response.status(200).send({
          id: tenant.id,
          name: tenant.name,
          contactName: tenant.contactName,
          location: tenant.location,
          mail: tenant.mail,
          phone: tenant.phone,
        });
      }
    } else {
      response.sendStatus(400);
    }
  }

  static async storeTenant(request, response) {
    const tenant = Object.assign(new Tenant(), request.body);
    let isUpdate = false;

      try {
        const existingTenant = await TenantManager.getTenant(tenant.id);
        isUpdate = existingTenant && existingTenant._id;
      } catch (error) {
        isUpdate = false;
      }

    if (isUpdate) {
      await TenantController.updateTenant(request, response);
    } else {
      await TenantController.createTenant(request, response);
    }
  }

  static async createTenant(request, response) {
    const user = request.user;
    const tenant = Object.assign(new Tenant(), request.body);

    tenant.ownerUserId = user.id;

    if (await TenantPermissions._allowCreate(tenant, user.id, user.tenant)) {
      const tenantAdmin = Object.assign(new Object(), user);
      tenantAdmin.tenant = tenant.id;
      tenantAdmin.roles = ["super-admin"];
      await UserManager.storeUser(tenantAdmin);

      tenant.genericMailTemplate = "default-generic-mail-template.temp";
      tenant.receiptTemplate = "default-receipt-template.temp";

      await TenantManager.storeTenant(tenant);

      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateTenant(request, response) {
    const user = request.user;
    const tenant = Object.assign(new Tenant(), request.body);
    if (await TenantPermissions._allowUpdate(tenant, user.id, user.tenant)) {
      await TenantManager.storeTenant(tenant);
      response.sendStatus(200);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeTenant(request, response) {
    const user = request.user;
    const id = request.params.id;

    const tenant = await TenantManager.getTenant(id);

    if (id) {
      if (await TenantPermissions._allowDelete(tenant, user.id, user.tenant)) {
        await TenantManager.removeTenant(id);
        response.sendStatus(200);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }
}

module.exports = TenantController;
