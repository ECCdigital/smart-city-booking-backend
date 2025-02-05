const { User, HookTypes } = require("../entities/user");
const bunyan = require("bunyan");
const { RoleModel } = require("../data-managers/role-manager");

const mongoose = require("mongoose");
const MailController = require("../mail-service/mail-controller");
const { RoleManager } = require("./role-manager");
const TenantManager = require("./tenant-manager");

const { Schema } = mongoose;

const UserSchema = new Schema(User.schema());
const UserModel = mongoose.models.User || mongoose.model("User", UserSchema);

const logger = bunyan.createLogger({
  name: "user-manager.js",
  level: process.env.LOG_LEVEL,
});

class UserManager {
  static async getUser(id) {
    const rawUser = await UserModel.findOne({ id: id });
    if (!rawUser) {
      return undefined;
    } else {
      return new User(rawUser);
    }
  }

  static async signupUser(user) {
    try {
      const newUser = await UserModel.create(user);
      await UserManager.requestVerification(newUser);
    } catch (err) {
      throw err;
    }
  }

  static async storeUser(user) {
    try {
      return await UserModel.replaceOne({ id: user.id }, user, {
        upsert: true,
      });
    } catch (err) {
      throw err;
    }
  }

  static async getUsers() {
    try {
      const rawUsers = await UserModel.find({});
      return rawUsers.map((ru) => new User(ru));
    } catch (err) {
      throw err;
    }
  }

  static async deleteUser(id) {
    try {
      return await UserModel.deleteOne({ id: id });
    } catch (err) {
      throw err;
    }
  }

  static async updateUser(user) {
    try {
      const updatedUser = await UserModel.replaceOne({ id: user.id }, user);
      return new User(updatedUser);
    } catch (err) {
      throw err;
    }
  }

  static async requestVerification(user) {
    const MailController = require("../mail-service/mail-controller");
    try {
      const hook = user.addHook(HookTypes.VERIFY);
      await UserManager.updateUser(user);
      await MailController.sendVerificationRequest(user.id, hook.id);
      return hook;
    } catch (err) {
      throw err;
    }
  }

  static async resetPassword(user, password) {
    try {
      const hook = user.addPasswordResetHook(password);
      await UserManager.updateUser(user);
      await MailController.sendPasswordResetRequest(user.id, hook.id);
    } catch (err) {
      throw err;
    }
  }

  static async releaseHook(hookId) {
    try {
      const user = await UserModel.findOne({ "hooks.id": hookId });
      if (!user) {
        throw new Error("No User found with this hook.");
      }
      const u = new User(user);
      const hookType = u.hooks.find((h) => h.id === hookId).type;
      if (u.releaseHook(hookId)) {
        await UserManager.updateUser(u);
        return hookType;
      } else {
        throw new Error("Hook does not exist.");
      }
    } catch (err) {
      throw err;
    }
  }

  static async hasPermission(userId, tenantId, permissionName, accessLevel) {
    if (!userId || !tenantId || !permissionName || !accessLevel) {
      return false;
    }
    try {
      const userPermissions = await UserManager.getUserPermissions(userId);

      const userTenantPermissions = userPermissions.find(
        (p) => p.tenantId === tenantId,
      );

      if (!userTenantPermissions || !userTenantPermissions[permissionName]) {
        return false;
      }

      return userTenantPermissions[permissionName][accessLevel] === true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  static async getUsersWithRoles(tenant, roles) {
    try {
      //TODO: Mapping
      return await UserModel.find({ tenant: tenant, roles: { $in: roles } });
    } catch (err) {
      throw err;
    }
  }

  static async getUserPermissions(userId) {
    const permissions = [];
    const tenants = await TenantManager.getTenants();

    // TODO: Could be that a user gets a role without any permissions (all permissions = false). This tenant would still be part of the permission object.

    for (const tenant of tenants) {
      // In the tenant, get the user reference that contains the roles.
      const tenantUserRef = tenant.users.find(
        (userRef) => userRef.userId === userId,
      );

      if (tenantUserRef) {
        const roleIds = tenantUserRef.roles;

        for (const roleId of roleIds) {
          const role = await RoleManager.getRole(roleId, tenant.id);

          if (role) {
            const workingPermission = permissions.find(
              (p) => p.tenantId === tenant.id,
            );

            if (!workingPermission) {
              permissions.push({
                tenantId: tenant.id,
                isOwner: tenant.ownerUserIds.includes(userId),
                adminInterfaces: role.adminInterfaces,
                freeBookings: role.freeBookings,
                manageRoles: role.manageRoles,
                manageBookables: role.manageBookables,
                manageBookings: role.manageBookings,
                manageCoupons: role.manageCoupons,
              });
            } else {
              workingPermission.adminInterfaces = [
                ...new Set([
                  ...workingPermission.adminInterfaces,
                  ...role.adminInterfaces,
                ]),
              ];

              workingPermission.freeBookings ||= role.freeBookings;

              const dimensions = [
                "manageRoles",
                "manageBookables",
                "manageBookings",
                "manageCoupons",
              ];
              const actions = [
                "create",
                "readAny",
                "readOwn",
                "updateAny",
                "updateOwn",
                "deleteAny",
                "deleteOwn",
              ];

              for (const dimension of dimensions) {
                for (const action of actions) {
                  workingPermission[dimension][action] ||=
                    role[dimension][action];
                }
              }
            }
          }
        }
      }
    }

    return permissions;
  }
}

module.exports = UserManager;
