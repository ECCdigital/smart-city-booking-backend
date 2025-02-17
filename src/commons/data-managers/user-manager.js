const { User, HookTypes } = require("../entities/user");
const mongoose = require("mongoose");
const { RoleManager } = require("./role-manager");
const TenantManager = require("./tenant-manager");
const InstanceManager = require("./instance-manager");

const { Schema } = mongoose;

const UserSchema = new Schema(User.schema());
const UserModel = mongoose.models.User || mongoose.model("User", UserSchema);

class UserManager {
  static async getUser(id, withSensitive = false) {
    const rawUser = await UserModel.findOne({ id: id });
    if (!rawUser) {
      return null;
    } else {
      const user = new User(rawUser);
      if (!withSensitive) {
        user.removeSensitive();
        return user;
      } else {
        return user;
      }
    }
  }

  static async signupUser(user) {
    try {
      const newUser = await UserModel.create(user);
      await UserManager.requestVerification(new User(newUser));
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

  static async getUsers(withSensitive = false) {
    try {
      const rawUsers = await UserModel.find({});
      return rawUsers.map((ru) => {
        const user = new User(ru);
        if (!withSensitive) {
          user.removeSensitive();
        }
        return user;
      });
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
      const updatedUser = await UserModel.updateOne({ id: user.id }, user, {
        upsert: true,
      });
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
    const MailController = require("../mail-service/mail-controller");
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

      const userTenantPermissions = userPermissions.tenants.find(
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

  static async getUserPermissions(userId) {
    const tenantPermissions = [];
    const tenants = await TenantManager.getTenants();
    const instance = await InstanceManager.getInstance(false);

    for (const tenant of tenants) {
      let tenantUserRef = tenant.users.find(
        (userRef) => userRef.userId === userId,
      );
      if (!tenantUserRef) {
        if (tenant.ownerUserIds.includes(userId)) {
          tenantUserRef = {
            userId: userId,
            roles: [],
          };
        } else {
          continue;
        }
      }

      let workingPermission = tenantPermissions.find(
        (p) => p.tenantId === tenant.id,
      );
      if (!workingPermission) {
        workingPermission = {
          tenantId: tenant.id,
          isOwner: tenant.ownerUserIds.includes(userId),
          adminInterfaces: [],
          freeBookings: false,
          manageRoles: {},
          manageBookables: {},
          manageBookings: {},
          manageCoupons: {},
        };
        tenantPermissions.push(workingPermission);
      }

      const roles = await Promise.all(
        tenantUserRef.roles.map((roleId) =>
          RoleManager.getRole(roleId, tenant.id),
        ),
      );

      for (const role of roles) {
        if (role) {
          mergeRoleIntoPermission(workingPermission, role);
        }
      }

      if (workingPermission.isOwner) {
        workingPermission.adminInterfaces = [
          ...new Set([
            ...workingPermission.adminInterfaces,
            "tenants",
            "users",
            "locations",
            "roles",
            "bookings",
            "coupons",
            "rooms",
            "resources",
            "tickets",
            "events",
          ]),
        ];
      }

      if (instance.ownerUserIds.includes(userId)) {
        workingPermission.adminInterfaces = [
          ...new Set([...workingPermission.adminInterfaces, "instance"]),
        ];
      }
    }

    const permissions = {
      tenants: tenantPermissions,
      allowCreateTenant: false,
    };
    if (
      instance.allowAllUsersToCreateTenant ||
      instance.allowedUsersToCreateTenant.includes(userId) ||
      instance.ownerUserIds.includes(userId)
    ) {
      permissions.allowCreateTenant = true;
    }

    return permissions;
  }
}

function mergeRoleIntoPermission(workingPermission, role) {
  workingPermission.adminInterfaces = [
    ...new Set([...workingPermission.adminInterfaces, ...role.adminInterfaces]),
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
    if (!workingPermission[dimension]) {
      workingPermission[dimension] = {};
    }
    if (!role[dimension]) {
      continue;
    }

    for (const action of actions) {
      workingPermission[dimension][action] ||= role[dimension][action];
    }
  }
}

module.exports = UserManager;
