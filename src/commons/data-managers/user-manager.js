const { User } = require("../entities/user/user");
const { RoleManager } = require("./role-manager");
const InstanceManager = require("./instance-manager");
const UserModel = require("./models/userModel");
const MembershipManager = require("./membership-manager");

class UserManager {
  static async getUser(id, withSensitive = false) {
    const rawUser = await UserModel.findOne({
      id: { $regex: id, $options: "i" },
    });
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

  static async createUser(user) {
    try {
      const userEntity = user instanceof User ? user : new User(user);

      userEntity.validate();

      const rawUser = await UserModel.create(userEntity);
      return rawUser.toEntity();
    } catch (err) {
      throw err;
    }
  }

  static async updateUser(user, upsert = true) {
    try {
      const userEntity = await UserModel.findOneAndUpdate(
        { id: user.id },
        user,
        {
          upsert: upsert,
        },
      );
      return userEntity.toEntity();
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

  static async resetPassword(user, password) {
    const MailController = require("../mail-service/mail-controller");
    try {
      const userEntity = user instanceof User ? user : new User(user);

      const hook = userEntity.addPasswordResetHook(password);
      await UserManager.updateUser(userEntity);
      await MailController.sendPasswordResetRequest(userEntity.id, hook.id);
      return hook;
    } catch (err) {
      throw err;
    }
  }

  static async getUserByHookID(hookID) {
    const rawUser = await UserModel.findOne({ "hooks.id": hookID });

    if (!rawUser) {
      throw new Error("No User found with this hook.");
    }

    return rawUser.toEntity();
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
    const instance = await InstanceManager.getInstance(false);
    const memberships = await MembershipManager.getMembershipsByUserID(userId);
    const filteredMemberschips = memberships.filter(
      (m) => m.status === "active",
    );

    for (const membership of filteredMemberschips) {
      let tenantUserRef = {
        userId: userId,
        roles: membership.roles,
      };

      let workingPermission = tenantPermissions.find(
        (p) => p.tenantId === membership.tenantId,
      );
      if (!workingPermission) {
        workingPermission = {
          tenantId: membership.tenantId,
          isOwner: membership.owner,
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
          RoleManager.getRole(roleId, membership.tenantId),
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
