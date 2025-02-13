const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user");
const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");

const logger = bunyan.createLogger({
  name: "user-controller.js",
  level: process.env.LOG_LEVEL,
});

class UserPermissions {
  static async _allowCreate() {
    return false;
  }

  static async _allowRead(user, userId) {
    const permissions = await UserManager.getUserPermissions(userId);
    if (await PermissionService._isInstanceOwner(userId)  || permissions.some((p) => p.isOwner)) {
      return true;
    } else {
      return PermissionService._isSelf(user, userId);
    }
  }

  static async _allowUpdate(affectedUser, userId) {
    return !!(
      await PermissionService._isInstanceOwner(userId)  || PermissionService._isSelf(affectedUser, userId)
    );
  }

  static async _allowDelete(affectedUser, userId) {
    return !!(
      await PermissionService._isInstanceOwner(userId) || PermissionService._isSelf(affectedUser, userId)
    );
  }
}

/**
 * Web Controller for Events.
 */
class UserController {
  static async getUsers(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      const userObjects = await UserManager.getUsers();

      const allowedUserObjects = [];
      for (const userObject of userObjects) {
        if (await UserPermissions._allowRead(userObject, user.id)) {
          allowedUserObjects.push(userObject);
        }
      }

      logger.info(
        `${tenantId} -- sending ${allowedUserObjects.length} users to user ${user?.id}`,
      );
      response.status(200).send(allowedUserObjects);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get Users");
    }
  }

  static async getUser(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (id) {
        if (await UserPermissions._allowRead(user, user.id, tenantId)) {
          const userObject = await UserManager.getUser(id);
          logger.info(
            `${tenantId} -- Sending user ${userObject.id} to user ${user?.id}`,
          );
          response.status(200).send(userObject);
        } else {
          logger.warn(
            `${tenantId} -- User ${user?.id} is not allowed to read user ${id}`,
          );
          response.sendStatus(403);
        }
      } else {
        response.sendStatus(400);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get user");
    }
  }

  /**
   * @obsolete Use createUser or updateUser instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeUser(request, response) {
    const userObject = new User(request.body);

    const isUpdate = !!(await UserManager.getUser(userObject.id)).id;

    if (isUpdate) {
      await UserController.updateUser(request, response);
    } else {
      await UserController.createUser(request, response);
    }
  }

  static async createUser(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;

      const userObject = new User(request.body);

      if (await UserPermissions._allowCreate(user.id)) {
        await UserManager.storeUser(userObject);
        logger.info(
          `${tenantId} -- created user ${userObject.id} by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(
          `${tenantId} -- User ${user?.id} not allowed to create user`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not create user");
    }
  }

  static async updateUser(request, response) {
    try {
      const user = request.user;

      const userObject = new User(request.body);
      if (await UserPermissions._allowUpdate(userObject, user.id)) {
        await UserManager.storeUser(userObject);
        logger.info(`updated user ${userObject.id} by user ${user?.id}`);
        response.sendStatus(200);
      } else {
        logger.warn(`User ${user?.id} not allowed to update user`);
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not update user");
    }
  }

  static async removeUser(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      const id = request.params.id;
      if (id) {
        const userObject = await UserManager.getUser(id);
        if (await UserPermissions._allowDelete(userObject, user.id)) {
          await UserManager.deleteUser(id);
          logger.info(`${tenantId} -- removed user ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(
            `${tenantId} -- User ${user?.id} not allowed to remove user`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `${tenantId} -- Could not remove user by user ${user?.id}. Missing required parameters.`,
        );
        response.sendStatus(400);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not remove user");
    }
  }

  // Allows only to change the display name
  static updateMe(request, response) {
    const user = new User(request.user);
    UserManager.getUser(user.id)
      .then((userFromDb) => {
        if (userFromDb) {
          if (user.id === userFromDb.id) {
            if (request.body.firstName && request.body.lastName) {
              userFromDb.firstName = request.body.firstName;
              userFromDb.lastName = request.body.lastName;
              userFromDb.company = request.body.company;
              userFromDb.phone = request.body.phone;
              userFromDb.address = request.body.address;
              userFromDb.zipCode = request.body.zipCode;
              userFromDb.city = request.body.city;
              UserManager.updateUser(userFromDb)
                .then(() => {
                  request.session.passport.user.firstName =
                    userFromDb.firstName;
                  request.session.passport.user.lastName = userFromDb.lastName;
                  request.session.passport.user.phone = userFromDb.phone;
                  request.session.passport.user.address = userFromDb.address;
                  request.session.passport.user.zipCode = userFromDb.zipCode;
                  request.session.passport.user.city = userFromDb.city;
                  request.session.save();
                  UserManager.getUserPermissions(userFromDb.id)
                    .then((permissions) => {
                      userFromDb.permissions = permissions;
                      response.status(200).send(userFromDb);
                    })
                    .catch((err) => {
                      console.error(err);
                      response.sendStatus(500);
                    });
                })
                .catch((error) => {
                  response.status(500).send(error);
                });
            } else {
              response.sendStatus(200);
            }
          } else {
            response.sendStatus(403);
          }
        } else {
          response.sendStatus(404);
        }
      })
      .catch((error) => {
        response.status(500).send(error);
      });
  }

  static async getUserIds(request, response) {
    try {
      const user = request.user;
      const tenant = request.params.tenant;
      const filterRoles = !!request.query.roles
        ? request.query.roles.split(",")
        : [];

      const userObjects = await UserManager.getUsers();

      const filteredUserObjects = userObjects.filter((userObject) => {
        if (filterRoles) {
          return filterRoles.some((role) => userObject.roles.includes(role));
        } else {
          return true;
        }
      });

      logger.info(
        `${tenant} -- sending ${filteredUserObjects.length} user ids to user ${user?.id}`,
      );
      response.status(200).send(filteredUserObjects.map((user) => user.id));
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get User IDs");
    }
  }
}

module.exports = UserController;
