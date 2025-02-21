const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user");
const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");

const logger = bunyan.createLogger({
  name: "user-controller.js",
  level: process.env.LOG_LEVEL,
});

class UserPermissions {
  static async _allowCreate(userId) {
    return !!(await PermissionService._isInstanceOwner(userId));
  }

  static async _allowRead(user, userId) {
    const permissions = await UserManager.getUserPermissions(userId);
    if (
      (await PermissionService._isInstanceOwner(userId)) ||
      permissions.tenants.some((p) => p.isOwner)
    ) {
      return true;
    } else {
      return PermissionService._isSelf(user, userId);
    }
  }

  static async _allowUpdate(affectedUser, userId) {
    return !!(await PermissionService._isInstanceOwner(userId));
  }

  static async _allowDelete(affectedUser, userId) {
    return !!(
      (await PermissionService._isInstanceOwner(userId)) ||
      PermissionService._isSelf(affectedUser, userId)
    );
  }
}

/**
 * Web Controller for Events.
 */
class UserController {

  /**
   * Retrieves a list of users that the current user is allowed to read.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the users are retrieved and sent in the response.
   */
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

  /**
   * Retrieves a specific user that the current user is allowed to read.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user is retrieved and sent in the response.
   */
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

    const isUpdate = !!(await UserManager.getUser(userObject.id));

    if (isUpdate) {
      await UserController.updateUser(request, response);
    } else {
      await UserController.createUser(request, response);
    }
  }

  /**
   * Creates a new user.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user is created.
   */
  static async createUser(request, response) {
    try {
      const user = request.user;
      if (await UserPermissions._allowCreate(user.id)) {
        const userObject = new User(request.body);
        userObject.setPassword(userObject.secret);
        const newUser = await UserManager.storeUser(userObject);
        logger.info(
          ` Instance -- created user ${userObject.id} by user ${user?.id}`,
        );
        response.status(200).send(newUser);
      } else {
        logger.warn(`Instance -- User ${user?.id} not allowed to create user`);
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not create user");
    }
  }

  /**
   * Updates a user's information.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user is updated.
   */
  static async updateUser(request, response) {
    try {
      const user = request.user;

      const newInfos = { id: request.body.id };

      const fields = [
        "firstName",
        "lastName",
        "company",
        "phone",
        "address",
        "zipCode",
        "city",
        "isVerified",
        "isSuspended",
      ];

      fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(request.body, field)) {
          newInfos[field] = request.body[field];
        }
      });

      if (await UserPermissions._allowUpdate(newInfos, user.id)) {
        await UserManager.storeUser(newInfos);
        logger.info(`updated user ${newInfos.id} by user ${user?.id}`);
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

  /**
   * Removes a user.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user is removed.
   */
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

  /**
   * Updates the current user's information.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the update is complete.
   */
  static async updateMe(request, response) {
    try {
      const user = new User(request.user);
      const newInfos = { id: user.id };

      const fields = [
        "firstName",
        "lastName",
        "company",
        "phone",
        "address",
        "zipCode",
        "city",
      ];

      fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(request.body, field)) {
          newInfos[field] = request.body[field];
        }
      });
      const updatedUser = await UserManager.storeUser(newInfos);

      request.session.passport.user.firstName = updatedUser.firstName;
      request.session.passport.user.lastName = updatedUser.lastName;
      request.session.passport.user.phone = updatedUser.phone;
      request.session.passport.user.address = updatedUser.address;
      request.session.passport.user.zipCode = updatedUser.zipCode;
      request.session.passport.user.city = updatedUser.city;
      request.session.save();

      response.status(200).send(updatedUser);
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not update user");
    }
  }

  /**
   * Retrieves a list of user IDs based on the specified roles.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user IDs are retrieved and sent in the response.
   */
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
