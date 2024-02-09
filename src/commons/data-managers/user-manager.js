const { User, HookTypes } = require("../entities/user");
var dbm = require("../utilities/database-manager");
const MailController = require("../mail-service/mail-controller");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "user-manager.js",
  level: process.env.LOG_LEVEL,
});

class UserManager {
  static getUser(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .findOne({ id: id, tenant: tenant })
        .then((user) => {
          if (!user) {
            resolve(undefined);
          } else {
            const u = new User(
              user.id,
              user.secret,
              user.tenant,
              user.firstName,
              user.lastName,
              user.phone,
              user.address,
              user.zipCode,
              user.city,
              user.hooks,
              user.isVerified,
              user.created,
              user.roles,
            );
            resolve(u);
          }
        })
        .catch((err) => reject(err));
    });
  }

  static signupUser(user) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .insertOne(user)
        .then((response) => {
          UserManager.requestVerification(user)
            .then(() => {
              resolve();
            })
            .catch((err) => reject(err));
        })
        .catch((err) => reject(err));
    });
  }

  static storeUser(user) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .replaceOne({ id: user.id, tenant: user.tenant }, user, {
          upsert: true,
        })
        .then(() => {
          resolve();
        })
        .catch((err) => reject(err));
    });
  }

  static getUsers(tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .find({ tenant: tenant })
        .toArray()
        .then((users) => {
          resolve(users);
        })
        .catch((err) => reject(err));
    });
  }

  static deleteUser(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .deleteOne({ id: id, tenant: tenant })
        .then((response) => resolve())
        .catch((err) => reject(err));
    });
  }

  static updateUser(user) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .replaceOne({ id: user.id, tenant: user.tenant }, user)
        .then((response) => resolve())
        .catch((err) => reject(err));
    });
  }

  static requestVerification(user) {
    return new Promise((resolve, reject) => {
      var hook = user.addHook(HookTypes.VERIFY);

      UserManager.updateUser(user)
        .then(() => {
          MailController.sendVerificationRequest(user.id, hook.id, user.tenant)
            .then(() => {
              resolve();
            })
            .catch((err) => reject(err));
        })
        .catch((err) => reject(err));
    });
  }

  static resetPassword(user, password) {
    return new Promise((resolve, reject) => {
      const hook = user.addPasswordResetHook(password);

      UserManager.updateUser(user)
        .then(() => {
          MailController.sendPasswordResetRequest(user.id, hook.id, user.tenant)
            .then(() => {
              resolve();
            })
            .catch((err) => reject(err));
        })
        .catch((err) => reject(err));
    });
  }

  static releaseHook(hookId) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .findOne({ "hooks.id": hookId })
        .then((user) => {
          if (user) {
            const u = new User(
              user.id,
              user.secret,
              user.tenant,
              user.firstName,
              user.lastName,
              user.phone,
              user.address,
              user.zipCode,
              user.city,
              user.hooks,
              user.isVerified,
              user.created,
              user.roles,
            );
            //find hook by id
            const hookType = u.hooks.find((h) => h.id === hookId).type;

            if (u.releaseHook(hookId)) {
              UserManager.updateUser(u)
                .then(() => {
                  resolve(hookType);
                })
                .catch((err) => reject(err));
            } else {
              reject(new Error("Hook does not exist."));
            }
          } else {
            reject(new Error("No User found with this hook."));
          }
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get the roles related to a specific user object.
   *
   * @param {string} userId ID of the user
   * @param {string} tenant The users tenant identifier
   * @returns Promise<Array of roles>
   */
  static getUserRoles(userId, tenant) {
    return new Promise((resolve, reject) => {
      UserManager.getUser(userId, tenant)
        .then((user) => {
          dbm
            .get()
            .collection("roles")
            .find({ id: { $in: user.roles } })
            .toArray()
            .then((roles) => {
              resolve(roles);
            });
        })
        .catch((err) => reject(err));
    });
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
      console.warn("UserManager.hasPermission: Missing parameter(s)!");
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

  static getUsersWithRoles(tenant, roles) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("users")
        .find({ tenant: tenant, roles: { $in: roles } })
        .toArray()
        .then((users) => {
          resolve(users);
        })
        .catch((err) => reject(err));
    });
  }
}

module.exports = UserManager;
