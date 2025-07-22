const { User, USER_HOOK_TYPES } = require("../entities/user/user");
const { RoleManager } = require("./role-manager");
const TenantManager = require("./tenant-manager");
const InstanceManager = require("./instance-manager");
const UserModel = require("./models/userModel");

class UserManager {
  static async getUser(id, withSensitive = false) {
    const rawUser = await UserModel.findOne({ id: { $regex: id, $options: 'i' } });
    if (!rawUser) {
      return null;
    }

    let user = rawUser.toEntity();
    if (!withSensitive) {
      user = user.exportPublic();
    }
    return user;
  }

  static async signupUser(user) {
    try {
      const userEntity = user instanceof User ? user : new User(user);

      userEntity.validate();

      const rawUser = await UserModel.create(userEntity);
      return rawUser.toEntity();
    } catch (err) {
      throw err;
    }
  }

  static async storeUser(user, upsert = true) {
    try {
      const userEntity = user instanceof User ? user : new User(user);

      userEntity.validate();

      await UserModel.updateOne({ id: userEntity.id }, userEntity, {
        upsert: upsert,
      });

      return userEntity;
    } catch (err) {
      throw err;
    }
  }

  static async getUsers(withSensitive = false) {
    try {
      const rawUsers = await UserModel.find({});
      return rawUsers.map((doc) => {
        let user = doc.toEntity();
        if (!withSensitive) {
          user = user.exportPublic();
        }
        return user;
      });
    } catch (err) {
      throw err;
    }
  }

  static async getUsersById(ids, withSensitive = false) {
    try {
      const rawUsers = await UserModel.find({ id: { $in: ids } });
      return rawUsers.map((doc) => {
        let user = doc.toEntity();
        if (!withSensitive) {
          user = user.exportPublic();
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

  static async requestVerification(user) {
    const MailController = require("../mail-service/mail-controller");
    try {
      const hook = user.addHook(USER_HOOK_TYPES.VERIFY);
      await UserManager.storeUser(user);
      await MailController.sendVerificationRequest(user.id, hook.id);
      return hook;
    } catch (err) {
      throw err;
    }
  }

  static async resetPassword(user, password) {
    const MailController = require("../mail-service/mail-controller");
    try {
      const userEntity = user instanceof User ? user : new User(user);

      const hook = userEntity.addPasswordResetHook(password);
      await UserManager.storeUser(userEntity);
      await MailController.sendPasswordResetRequest(userEntity.id, hook.id);
      return hook;
    } catch (err) {
      throw err;
    }
  }

  static async releaseHook(hookId) {
    try {
      const rawUser = await UserModel.findOne({ "hooks.id": hookId });
      if (!rawUser) {
        throw new Error("No User found with this hook.");
      }

      const user = rawUser.toEntity();
      const hook = user.hooks.find((hook) => hook.id === hookId);

      if (!hook) {
        throw new Error("Hook does not exist.");
      }

      const hookType = hook.type;

      if (user.releaseHook(hookId)) {
        await UserManager.storeUser(user);
        return hookType;
      } else {
        throw new Error("Failed to release hook.");
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
      return (
        userTenantPermissions.isOwner ||
        userTenantPermissions[permissionName][accessLevel] === true
      );
    } catch (err) {
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
          manageUsers: {},
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
    }

    const permissions = {
      tenants: tenantPermissions,
      allowCreateTenant: false,
      instanceOwner: instance.ownerUserIds.includes(userId),
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
    "manageUsers",
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
