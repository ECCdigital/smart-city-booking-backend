const { User, HookTypes } = require("../entities/user");
const bunyan = require("bunyan");
const { RoleModel } = require("../data-managers/role-manager");

const mongoose = require("mongoose");
const MailController = require("../mail-service/mail-controller");
const { Role } = require("../entities/role");

const { Schema } = mongoose;

const UserSchema = new Schema(User.schema());
const UserModel = mongoose.models.User || mongoose.model("User", UserSchema);

const logger = bunyan.createLogger({
  name: "user-manager.js",
  level: process.env.LOG_LEVEL,
});

class UserManager {
  static async getUser(id, tenant) {
    const rawUser = await UserModel.findOne({ id: id, tenant: tenant });
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
      return await UserModel.replaceOne(
        { id: user.id, tenant: user.tenant },
        user,
        {
          upsert: true,
        },
      );
    } catch (err) {
      throw err;
    }
  }

  static async getUsers(tenant) {
    try {
      const rawUsers = await UserModel.find({ tenant: tenant });
      return rawUsers.map((ru) => new User(ru));
    } catch (err) {
      throw err;
    }
  }

  static async deleteUser(id, tenant) {
    try {
      return await UserModel.deleteOne({ id: id, tenant: tenant });
    } catch (err) {
      throw err;
    }
  }

  static async updateUser(user) {
    try {
      const updatedUser = await UserModel.replaceOne(
        { id: user.id, tenant: user.tenant },
        user,
      );
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
      await MailController.sendVerificationRequest(
        user.id,
        hook.id,
        user.tenant,
      );
      return hook;
    } catch (err) {
      throw err;
    }
  }

  static async resetPassword(user, password) {
    try {
      const hook = user.addPasswordResetHook(password);
      await UserManager.updateUser(user);
      await MailController.sendPasswordResetRequest(
        user.id,
        hook.id,
        user.tenant,
      );
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

  /**
   * Get the roles related to a specific user object.
   *
   * @param {string} userId ID of the user
   * @param {string} tenant The users tenant identifier
   * @returns Promise<Array of roles>
   */
  static async getUserRoles(userId, tenant) {
    try {
      const user = await UserManager.getUser(userId, tenant);
      if (!user) {
        throw new Error(`User ${userId} not found.`);
      }
      const rawRoles = await RoleModel.find({ id: { $in: user.roles } });
      return rawRoles.map((rr) => {
        return new Role(rr);
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get the permission of a specific user. To determine the specific user permission, all roles a user is related to
   * are combined.
   *
   * @param {string} userId ID of the user
   * @param {string} tenant The users tenant identifier
   * @returns Promise<Permission object>
   */
  static getUserPermissions(userId, tenant) {
    return new Promise((resolve, reject) => {
      UserManager.getUserRoles(userId, tenant)
        .then((roles) => {
          // Combine role permissions to specific user permissions
          if (roles.length === 0) {
            logger.warn(`${tenant} -- User ${userId} has no roles assigned.}`);
            resolve({});
          } else {
            const permissions = roles.reduce((prev, curr) => {
              return {
                adminInterfaces: prev.adminInterfaces
                  .concat(curr.adminInterfaces)
                  .filter((v, i, a) => a.indexOf(v) === i),
                manageBookables: {
                  create:
                    prev.manageBookables.create || curr.manageBookables.create,
                  readOwn:
                    prev.manageBookables.readOwn ||
                    curr.manageBookables.readOwn,
                  readAny:
                    prev.manageBookables.readAny ||
                    curr.manageBookables.readAny,
                  updateOwn:
                    prev.manageBookables.updateOwn ||
                    curr.manageBookables.updateOwn,
                  updateAny:
                    prev.manageBookables.updateAny ||
                    curr.manageBookables.updateAny,
                  deleteOwn:
                    prev.manageBookables.deleteOwn ||
                    curr.manageBookables.deleteOwn,
                  deleteAny:
                    prev.manageBookables.deleteAny ||
                    curr.manageBookables.deleteAny,
                },
                manageTenants: {
                  create:
                    prev.manageTenants.create || curr.manageTenants.create,
                  readOwn:
                    prev.manageTenants.readOwn || curr.manageTenants.readOwn,
                  readAny:
                    prev.manageTenants.readAny || curr.manageTenants.readAny,
                  updateOwn:
                    prev.manageTenants.updateOwn ||
                    curr.manageTenants.updateOwn,
                  updateAny:
                    prev.manageTenants.updateAny ||
                    curr.manageTenants.updateAny,
                  deleteOwn:
                    prev.manageTenants.deleteOwn ||
                    curr.manageTenants.deleteOwn,
                  deleteAny:
                    prev.manageTenants.deleteAny ||
                    curr.manageTenants.deleteAny,
                },
                manageUsers: {
                  create:
                    prev.manageUsers.create || curr.manageBookables.create,
                  readOwn: prev.manageUsers.readOwn || curr.manageUsers.readOwn,
                  readAny: prev.manageUsers.readAny || curr.manageUsers.readAny,
                  updateOwn:
                    prev.manageUsers.updateOwn || curr.manageUsers.updateOwn,
                  updateAny:
                    prev.manageUsers.updateAny || curr.manageUsers.updateAny,
                  deleteOwn:
                    prev.manageUsers.deleteOwn || curr.manageUsers.deleteOwn,
                  deleteAny:
                    prev.manageUsers.deleteAny || curr.manageUsers.deleteAny,
                },
                manageBookings: {
                  create:
                    prev.manageBookings.create || curr.manageBookings.create,
                  readOwn:
                    prev.manageBookings.readOwn || curr.manageBookings.readOwn,
                  readAny:
                    prev.manageBookings.readAny || curr.manageBookings.readAny,
                  updateOwn:
                    prev.manageBookings.updateOwn ||
                    curr.manageBookings.updateOwn,
                  updateAny:
                    prev.manageBookings.updateAny ||
                    curr.manageBookings.updateAny,
                  deleteOwn:
                    prev.manageBookings.deleteOwn ||
                    curr.manageBookings.deleteOwn,
                  deleteAny:
                    prev.manageBookings.deleteAny ||
                    curr.manageBookings.deleteAny,
                },
                manageRoles: {
                  create: prev.manageRoles.create || curr.manageRoles.create,
                  readOwn: prev.manageRoles.readOwn || curr.manageRoles.readOwn,
                  readAny: prev.manageRoles.readAny || curr.manageRoles.readAny,
                  updateOwn:
                    prev.manageRoles.updateOwn || curr.manageRoles.updateOwn,
                  updateAny:
                    prev.manageRoles.updateAny || curr.manageRoles.updateAny,
                  deleteOwn:
                    prev.manageRoles.deleteOwn || curr.manageRoles.deleteOwn,
                  deleteAny:
                    prev.manageRoles.deleteAny || curr.manageRoles.deleteAny,
                },
                manageCoupons: {
                  create:
                    prev.manageCoupons.create || curr.manageCoupons.create,
                  readOwn:
                    prev.manageCoupons.readOwn || curr.manageCoupons.readOwn,
                  readAny:
                    prev.manageCoupons.readAny || curr.manageCoupons.readAny,
                  updateOwn:
                    prev.manageCoupons.updateOwn ||
                    curr.manageCoupons.updateOwn,
                  updateAny:
                    prev.manageCoupons.updateAny ||
                    curr.manageCoupons.updateAny,
                  deleteOwn:
                    prev.manageCoupons.deleteOwn ||
                    curr.manageCoupons.deleteOwn,
                  deleteAny:
                    prev.manageCoupons.deleteAny ||
                    curr.manageCoupons.deleteAny,
                },
                freeBookings: prev.freeBookings || curr.freeBookings,
              };
            });
            resolve(permissions);
          }
        })
        .catch((err) => reject(err));
    });
  }

  static async hasPermission(userId, tenant, permissionName, accessLevel) {
    if (!userId || !tenant || !permissionName || !accessLevel) {
      return false;
    }
    try {
      const permissions = await UserManager.getUserPermissions(userId, tenant);

      if (!permissions[permissionName]) {
        return false;
      }

      return permissions[permissionName][accessLevel] === true;
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
}

module.exports = UserManager;
