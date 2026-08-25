const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user/user");
const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");
const UserService = require("../../../commons/services/user-service");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const JwtHelper = require("../../../commons/utilities/jwt-helper");

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
    return !!(
      (await PermissionService._isInstanceOwner(userId)) ||
      PermissionService._isSelf(affectedUser, userId)
    );
  }

  static async _allowDelete(affectedUser, userId) {
    return !!(await PermissionService._isInstanceOwner(userId));
  }
}

/**
 * Web Controller for Events.
 */
class UserController {
  static async _findRawUserByIdOrKeycloak(userId, keycloakId = null) {
    return await UserManager.findRawUserByIdOrKeycloak(userId, keycloakId);
  }

  /**
   * Retrieves a list of users that the current user is allowed to read.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the users are retrieved and sent in the response.
   */
  static async getUsers(request, response) {
    try {
      const user = request.user;

      const userObjects = await UserManager.getUsers();

      const allowedUserObjects = [];
      for (const userObject of userObjects) {
        if (await UserPermissions._allowRead(userObject, user.id)) {
          allowedUserObjects.push(userObject);
        }
      }

      logger.info(
        `Instance -- sending ${allowedUserObjects.length} users to user ${user?.id}`,
      );
      response.status(200).send(allowedUserObjects);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get Users");
    }
  }

  static async getUsersByTenant(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;

      if (
        !(await PermissionService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        ))
      ) {
        logger.warn(`User ${user?.id} not allowed to get tenant users`);
        response.sendStatus(403);
        return;
      }
      const tenantUsers =
        await MembershipManager.getMembershipsByTenantID(tenantId);

      logger.info(
        `Instance -- sending ${tenantUsers.length} users to user ${user?.id}`,
      );
      response.status(200).send(tenantUsers);
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
        const newUser = await UserManager.createUser(userObject);
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
      const keycloakId = String(request.body.keycloakId || "").trim();

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

      if (keycloakId) {
        newInfos.keycloakId = keycloakId;
      }

      const hasUserUpdatePermission = await UserPermissions._allowUpdate(
        newInfos,
        user.id,
      );

      if (hasUserUpdatePermission) {
        const existingUser = await UserManager.getUser(newInfos.id, true);
        if (!existingUser) {
          response.status(404).send("User not found");
          return;
        }

        await UserManager.updateUser(newInfos);

        if (
          (Object.prototype.hasOwnProperty.call(newInfos, "firstName") ||
            Object.prototype.hasOwnProperty.call(newInfos, "lastName")) &&
          request.body.syncSelfBookingNames !== false
        ) {
          const firstName = Object.prototype.hasOwnProperty.call(
            newInfos,
            "firstName",
          )
            ? newInfos.firstName
            : existingUser.firstName;
          const lastName = Object.prototype.hasOwnProperty.call(
            newInfos,
            "lastName",
          )
            ? newInfos.lastName
            : existingUser.lastName;
          await UserService.syncSelfBookingNames(
            newInfos.id,
            firstName,
            lastName,
          );
        }

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
   * Changes a user's id (email) and updates all relevant references.
   */
  static async changeUserId(request, response) {
    try {
      const actor = request.user;
      const currentId = request.params.id;
      const { newId, keycloakId = null, anonymize = false } = request.body;
      const currentUser = await UserController._findRawUserByIdOrKeycloak(
        currentId,
        keycloakId,
      );
      if (!currentUser) {
        response.status(404).send("User not found");
        return;
      }

      const hasUserUpdatePermission = await UserPermissions._allowUpdate(
        { id: currentUser.id },
        actor.id,
      );

      if (!hasUserUpdatePermission) {
        logger.warn(`User ${actor?.id} not allowed to change user id`);
        response.sendStatus(403);
        return;
      }

      const changeResult = await UserService.changeUserId({
        currentId,
        newId,
        keycloakId,
        anonymize,
      });

      logger.info(
        `changed user id ${changeResult.previousId} -> ${changeResult.id} by user ${actor?.id}`,
      );
      response.status(200).send(changeResult);
    } catch (error) {
      logger.error(error);
      response
        .status(error.status || 500)
        .send(error.message || "could not change user id");
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
      const tenantId = request.query.tenant || request.body?.tenantId;
      const user = request.user;

      const id = request.params.id;
      const keycloakId = request.query.keycloakId || request.body?.keycloakId;
      if (id) {
        const rawUser = await UserController._findRawUserByIdOrKeycloak(
          id,
          keycloakId,
        );
        if (!rawUser) {
          response.sendStatus(404);
          return;
        }

        const userObject = rawUser.toEntity();
        const hasUserDeletePermission = await UserPermissions._allowDelete(
          userObject,
          user.id,
        );

        if (hasUserDeletePermission) {
          await UserManager.deleteUser(userObject.id);
          logger.info(
            `${tenantId} -- removed user ${userObject.id} by user ${user?.id}`,
          );
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
      const user = await UserManager.getUser(request.user.id, true);

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
          user[field] = request.body[field];
        }
      });

      await UserManager.updateUser(user);

      if (
        (Object.prototype.hasOwnProperty.call(request.body, "firstName") ||
          Object.prototype.hasOwnProperty.call(request.body, "lastName")) &&
        request.body.syncSelfBookingNames !== false
      ) {
        await UserService.syncSelfBookingNames(
          user.id,
          user.firstName,
          user.lastName,
        );
      }

      const updatedUser = await UserManager.getUser(user.id, false);

      response.status(200).send(updatedUser);
    } catch (error) {
      logger.error(error);
      response.status(500).send("could not update user");
    }
  }

  static async changeMyPassword(request, response) {
    try {
      const { currentPassword, newPassword } = request.body;
      if (!currentPassword || !newPassword) {
        return response
          .status(400)
          .send("Current and new password are required");
      }
      const password = String(newPassword);
      if (
        password.length < 8 ||
        !/[A-Za-z]/.test(password) ||
        !/\d/.test(password)
      ) {
        return response
          .status(400)
          .send(
            "Password must be at least 8 characters and include a letter and a number",
          );
      }
      const user = await UserManager.getUserBy({ id: request.user.id }, true);
      if (!user) {
        return response.sendStatus(404);
      }
      if (!user.verifyPassword(currentPassword)) {
        return response.status(403).send("Current password is incorrect");
      }
      user.setPassword(newPassword);
      await UserManager.updateUser(user);
      await JwtHelper.revokeAllUserTokens(request.user.id, "password_changed");
      return response.sendStatus(200);
    } catch (error) {
      logger.error(error);
      return response.status(500).send("could not change password");
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
