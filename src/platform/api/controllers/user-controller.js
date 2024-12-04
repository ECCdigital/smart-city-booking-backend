const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user");
const { RolePermission } = require("../../../commons/entities/role");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "user-controller.js",
  level: process.env.LOG_LEVEL,
});

class UserPermissions {
  static _isSelf(user, userId, userTenant) {
    return user.id === userId && user.tenant === userTenant;
  }

  static async _allowCreate(user, userId, tenant) {
    return await UserManager.hasPermission(
      userId,
      tenant,
      RolePermission.MANAGE_USERS,
      "create",
    );
  }

  static async _allowRead(user, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "readAny",
      )
    ) {
      return true;
    }

    if (
      UserPermissions._isSelf(user, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "readOwn",
      ))
    ) {
      return true;
    }

    return false;
  }

  static async _allowUpdate(user, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "updateAny",
      )
    )
      return true;

    if (
      UserPermissions._isSelf(user, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "updateOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(user, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "deleteAny",
      )
    )
      return true;

    if (
      UserPermissions._isSelf(user, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "deleteOwn",
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Events.
 */
class UserController {
  static async getUsers(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const userObjects = await UserManager.getUsers(tenant);

      const allowedUserObjects = [];
      for (const userObject of userObjects) {
        if (
          await UserPermissions._allowRead(userObject, user.id, user.tenant)
        ) {
          allowedUserObjects.push(userObject);
        }
      }

      logger.info(
        `${tenant} -- sending ${allowedUserObjects.length} users to user ${user?.id}`,
      );
      response.status(200).send(allowedUserObjects);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get Users");
    }
  }

  static async getUser(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (id) {
        if (await UserPermissions._allowRead(user, user.id, user.tenant)) {
          const userObject = await UserManager.getUser(id, tenant);
          logger.info(
            `${tenant} -- Sending user ${userObject.id} to user ${user?.id}`,
          );
          response.status(200).send(userObject);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to read user ${id}`,
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
    const tenant = request.params.tenant;
    const userObject = Object.assign(new User(), request.body);

    const isUpdate = !!(await UserManager.getUser(userObject.id, tenant))._id;

    if (isUpdate) {
      await UserController.updateUser(request, response);
    } else {
      await UserController.createUser(request, response);
    }
  }

  static async createUser(request, response) {
    try {
      const user = request.user;

      const userObject = Object.assign(new User(), request.body);

      if (
        await UserPermissions._allowCreate(userObject, user.id, user.tenant)
      ) {
        await UserManager.storeUser(userObject);
        logger.info(
          `${user?.tenant} -- created user ${userObject.id} by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(
          `${user?.tenant} -- User ${user?.id} not allowed to create user`,
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

      const userObject = Object.assign(new User(), request.body);

      if (
        await UserPermissions._allowUpdate(userObject, user.id, user.tenant)
      ) {
        await UserManager.storeUser(userObject);
        logger.info(
          `${user.tenant} -- updated user ${userObject.id} by user ${user?.id}`,
        );
        response.sendStatus(200);
      } else {
        logger.warn(
          `${user?.tenant} -- User ${user?.id} not allowed to update user`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not update user");
    }
  }

  static async removeUser(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const id = request.params.id;
      if (id) {
        const userObject = await UserManager.getUser(id, tenant);

        if (
          await UserPermissions._allowDelete(userObject, user.id, user.tenant)
        ) {
          await UserManager.deleteUser(id, tenant);
          logger.info(`${tenant} -- removed user ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} not allowed to remove user`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `${tenant} -- Could not remove user by user ${user?.id}. Missing required parameters.`,
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
    const user = Object.assign(new User(), request.user);
    console.log("updateme", user);

    // get user from db
    UserManager.getUser(user.id, user.tenant)
      .then((userFromDb) => {
        //check if user exists
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
                  UserManager.getUserPermissions(
                    userFromDb.id,
                    userFromDb.tenant,
                  )
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

      const userObjects = await UserManager.getUsers(tenant);
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
