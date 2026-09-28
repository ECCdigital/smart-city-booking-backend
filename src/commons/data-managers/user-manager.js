const { User } = require("../entities/user/user");
const { RoleManager } = require("./role-manager");
const InstanceManager = require("./instance-manager");
const UserModel = require("./models/userModel");
const MembershipManager = require("./membership-manager");
const TenantManager = require("./tenant-manager");
const { escapeRegex } = require("../utilities/regex-utils");
const { DOMAIN } = require("../services/authorization/reach");
const {
  supervisionOf,
} = require("../services/supervision/supervision-constants");
const { ROLE_GROUPS, ROLE_LEVELS } = require("../entities/role/role-catalogue");

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

  static async getUserByHookID(hookID) {
    const rawUser = await UserModel.findOne({ "hooks.id": hookID });

    if (!rawUser) {
      return null;
    }

    return rawUser.toEntity();
  }

  /**
   * The membership picture of a user (glossary "Mitgliedschaftsbild", ADR
   * 0004): loaded once per user, what the principal of the authorization
   * and the sign-in answer are built from. The instance flags, and per
   * active membership the tenant, the owner flag, the supervision of the
   * tenant (a tenant whose document is gone reads as one without a stored
   * level), the role levels merged over the role catalogue and the two
   * extras of the roles. Two memberships in one tenant merge into one
   * entry. The instance, the memberships, the roles of a tenant and the
   * tenants are read once each; roles are configuration (ticket 22/4).
   *
   * @param {string} userId
   * @returns {Promise<{instanceOwner: boolean, mayCreateTenant: boolean, memberships: Array<{tenantId: string, isOwner: boolean, supervision: {supervisionLevel: string, supervisionChangedAt: Date|null, supervisionReason: string|null}, grants: Object<string, Object<string, boolean>>, adminInterfaces: string[], freeBookings: boolean}>}>}
   */
  static async getMembershipPicture(userId) {
    const instance = await InstanceManager.getInstance(false);
    const memberships = (
      await MembershipManager.getMembershipsByUserID(userId)
    ).filter((m) => m.status === "active");

    const entries = [];
    for (const membership of memberships) {
      let entry = entries.find((e) => e.tenantId === membership.tenantId);
      if (!entry) {
        entry = {
          tenantId: membership.tenantId,
          isOwner: membership.owner,
          supervision: null,
          grants: Object.fromEntries(ROLE_GROUPS.map((group) => [group, {}])),
          adminInterfaces: [],
          freeBookings: false,
        };
        entries.push(entry);
      }
      const roles = await RoleManager.getRolesByIds(
        membership.roles,
        membership.tenantId,
      );
      for (const role of roles) {
        mergeRoleInto(entry, role);
      }
    }

    const tenants = await TenantManager.getTenantsByIds(
      entries.map((entry) => entry.tenantId),
      DOMAIN,
    );
    for (const entry of entries) {
      entry.supervision = supervisionOf(
        tenants.find((t) => t.id === entry.tenantId),
      );
    }

    const isInstanceOwner = instance.ownerUserIds.includes(userId);
    return {
      instanceOwner: isInstanceOwner,
      mayCreateTenant:
        isInstanceOwner ||
        instance.allowAllUsersToCreateTenant === true ||
        instance.allowedUsersToCreateTenant.includes(userId),
      memberships: entries,
    };
  }

  /**
   * The sign-in answer (`/auth/signin`, `/auth/me`, the SSO and the card
   * sign-in): a projection of the membership picture, never its source
   * (ADR 0004). Per tenant the owner flag, the admin interfaces (an owner
   * gets every one), `freeBookings`, the role levels written out by group
   * and the supervision of the tenant (tenant supervision spec §6.1). A
   * declined tenant shows every flag here; only the principal lets the
   * membership rest (#299, Q12).
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  static async getUserPermissions(userId) {
    return signInPermissionsOf(await UserManager.getMembershipPicture(userId));
  }
}

/** The admin interfaces every tenant owner sees, whatever the roles say. */
const OWNER_INTERFACES = Object.freeze([
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
]);

/**
 * The sign-in answer from the membership picture: see `getUserPermissions`.
 *
 * @param {Object} picture - The answer of `getMembershipPicture`.
 * @returns {Object}
 */
function signInPermissionsOf(picture) {
  return {
    tenants: picture.memberships.map((membership) => ({
      tenantId: membership.tenantId,
      isOwner: membership.isOwner,
      adminInterfaces: membership.isOwner
        ? [...new Set([...membership.adminInterfaces, ...OWNER_INTERFACES])]
        : [...membership.adminInterfaces],
      freeBookings: membership.freeBookings,
      ...Object.fromEntries(
        ROLE_GROUPS.map((group) => [group, { ...membership.grants[group] }]),
      ),
      ...membership.supervision,
    })),
    allowCreateTenant: picture.mayCreateTenant,
    instanceOwner: picture.instanceOwner,
  };
}

/**
 * Merges a role into an entry of the membership picture: a level a role
 * grants stays granted, the extras union (`adminInterfaces`) and or
 * (`freeBookings`).
 */
function mergeRoleInto(entry, role) {
  entry.adminInterfaces = [
    ...new Set([...entry.adminInterfaces, ...role.adminInterfaces]),
  ];
  entry.freeBookings ||= role.freeBookings;

  for (const group of ROLE_GROUPS) {
    if (!role[group]) {
      continue;
    }
    for (const level of ROLE_LEVELS) {
      entry.grants[group][level] ||= role[group][level];
    }
  }
}

module.exports = UserManager;
