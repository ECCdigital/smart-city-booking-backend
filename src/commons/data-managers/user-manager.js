const { User } = require("../entities/user/user");
const { RoleManager } = require("./role-manager");
const InstanceManager = require("./instance-manager");
const UserModel = require("./models/userModel");
const MembershipManager = require("./membership-manager");
const { escapeRegex } = require("../utilities/regex-utils");

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

  static async getRawUser(id) {
    const rawUser = await UserModel.findOne({
      id: { $regex: id, $options: "i" },
    });
    return rawUser;
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

  static async getUserBy(filter, withSensitive = false) {
    const rawUser = await UserModel.findOne(filter);
    if (!rawUser) {
      return null;
    }

    let user = rawUser.toEntity();
    if (!withSensitive) {
      user = user.exportPublic();
    }
    return user;
  }

  static async getRawUserBy(filter) {
    return await UserModel.findOne(filter);
  }

  static async findRawUserByIdOrKeycloak(userId, keycloakId = null) {
    const normalizedUserId = String(userId || "")
      .trim()
      .toLowerCase();
    const normalizedKeycloakId = String(keycloakId || "").trim();

    let rawUser = null;
    if (normalizedUserId) {
      rawUser = await UserModel.findOne({ id: normalizedUserId });
      if (!rawUser) {
        rawUser = await UserModel.findOne({
          id: { $regex: `^${escapeRegex(normalizedUserId)}$`, $options: "i" },
        });
      }
    }

    if (!rawUser && normalizedKeycloakId) {
      rawUser = await UserModel.findOne({ keycloakId: normalizedKeycloakId });
    }

    return rawUser;
  }

  /**
   * Resolves a local user from Keycloak token claims.
   * Prefers keycloakId (sub) over email; syncs keycloakId when found by email only.
   */
  static async resolveKeycloakUser(
    claims,
    { withSensitive = false, syncKeycloakId = true } = {},
  ) {
    const keycloakId = String(claims?.sub || "").trim();
    const email = String(claims?.email || claims?.preferred_username || "")
      .trim()
      .toLowerCase();

    let user = null;
    let userKeycloakId = null;
    let keycloakBoundUserId = null;
    let emailBoundUserId = null;

    if (keycloakId) {
      const keycloakUser = await UserManager.getUserBy(
        { keycloakId },
        withSensitive,
      );
      if (keycloakUser) {
        keycloakBoundUserId = keycloakUser.id;
        userKeycloakId = keycloakUser.keycloakId;
        user = keycloakUser;
      }
    }

    if (email) {
      const emailUser = await UserManager.getUser(email, withSensitive);
      if (emailUser) {
        emailBoundUserId = emailUser.id;
        if (!user) {
          user = emailUser;
        }
      }
    }

    if (
      keycloakBoundUserId &&
      emailBoundUserId &&
      keycloakBoundUserId.toLowerCase() !== emailBoundUserId.toLowerCase()
    ) {
      throw {
        message: "Identity conflict: email already bound to another account",
        status: 409,
      };
    }

    if (!user) {
      throw {
        message: "User not found",
        status: 404,
        keycloakEmail: email || null,
      };
    }

    if (syncKeycloakId && keycloakId && userKeycloakId !== keycloakId) {
      await UserManager.updateUser({ id: user.id, keycloakId }, false);
      user.keycloakId = keycloakId;
    }

    return user;
  }

  static async updateUserByMongoId(mongoId, userSet, session = null) {
    const options = session ? { session } : {};
    await UserModel.updateOne({ _id: mongoId }, { $set: userSet }, options);
  }

  static async updateUserNamesByMongoId(
    mongoId,
    firstName,
    lastName,
    keycloakId = null,
  ) {
    const updateSet = {
      firstName,
      lastName,
    };

    if (keycloakId) {
      updateSet.keycloakId = keycloakId;
    }

    return await UserModel.findOneAndUpdate(
      { _id: mongoId },
      { $set: updateSet },
      { new: true },
    );
  }

  static async getUserByCard(appId, publicId) {
    return await UserModel.findOne({
      "cardAuth.appId": appId,
      "cardAuth.publicId": publicId,
    }).lean();
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
      return null;
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
          manageMedia: {},
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
            "media",
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
    "manageMedia",
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
