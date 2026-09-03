const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user/user");
const bunyan = require("bunyan");
const UserService = require("../../../commons/services/user-service");
const { decide } = require("../../../commons/services/authorization");
const ApiResponse = require("../../../commons/utilities/api-response");
const { ForbiddenError, NotFoundError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "user-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for the users of the instance. The right is the router's
 * (`user.read`, `user.update`, `user.delete`, `user.changeId`: the instance
 * owner; `user.updateSelf`: the signed-in user's own record); the one
 * decision left to the adapter is the creation over the obsolete PUT.
 */
class UserController {
  static async _findRawUserByIdOrKeycloak(userId, keycloakId = null) {
    return await UserManager.findRawUserByIdOrKeycloak(userId, keycloakId);
  }

  /** The 404 of a user the manager did not find. */
  static _notFound(response, id) {
    return ApiResponse.fail(
      response,
      new NotFoundError("user_not_found", { id }),
    );
  }

  /**
   * Retrieves the users of the instance.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the users are retrieved and sent in the response.
   */
  static async getUsers(request, response) {
    try {
      const user = request.user;

      const userObjects = await UserManager.getUsers();

      logger.info(
        `Instance -- sending ${userObjects.length} users to user ${user?.id}`,
      );
      response.status(200).send(userObjects);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get Users");
    }
  }

  /**
   * Retrieves a specific user.
   *
   * @param {Object} request - The request object.
   * @param {Object} response - The response object.
   * @returns {Promise<void>} - A promise that resolves when the user is retrieved and sent in the response.
   */
  static async getUser(request, response) {
    try {
      const user = request.user;
      const id = request.params.id;

      if (!id) {
        return response.sendStatus(400);
      }

      const userObject = await UserManager.getUser(id);
      if (!userObject) {
        return UserController._notFound(response, id);
      }

      logger.info(
        `Instance -- Sending user ${userObject.id} to user ${user?.id}`,
      );
      response.status(200).send(userObject);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get user");
    }
  }

  /**
   * @deprecated Use createUser or updateUser instead.
   *
   * The route carries `user.update`; an unknown id creates, which is the
   * adapter's second decision (authorize spec §12).
   *
   * @param request
   * @param response
   * @param next
   * @returns {Promise<void>}
   */
  static async storeUser(request, response, next) {
    const userObject = new User(request.body);

    const isUpdate = !!(await UserManager.getUser(userObject.id));

    if (isUpdate) {
      await UserController.updateUser(request, response);
    } else if (decide(request.principal, "user", "create") !== "any") {
      return next(new ForbiddenError());
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
      const userObject = new User(request.body);
      userObject.setPassword(userObject.secret);
      const newUser = await UserManager.createUser(userObject);
      logger.info(
        ` Instance -- created user ${userObject.id} by user ${user?.id}`,
      );
      response.status(200).send(newUser);
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

      const existingUser = await UserManager.getUser(newInfos.id, true);
      if (!existingUser) {
        return UserController._notFound(response, newInfos.id);
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
        return UserController._notFound(response, currentId);
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
      const user = request.user;

      const id = request.params.id;
      const keycloakId = request.query.keycloakId || request.body?.keycloakId;
      if (!id) {
        logger.warn(
          `Instance -- Could not remove user by user ${user?.id}. Missing required parameters.`,
        );
        return response.sendStatus(400);
      }

      const rawUser = await UserController._findRawUserByIdOrKeycloak(
        id,
        keycloakId,
      );
      if (!rawUser) {
        return UserController._notFound(response, id);
      }

      const userObject = rawUser.toEntity();
      await UserManager.deleteUser(userObject.id);
      logger.info(
        `Instance -- removed user ${userObject.id} by user ${user?.id}`,
      );
      response.sendStatus(200);
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
        `Instance -- sending ${filteredUserObjects.length} user ids to user ${user?.id}`,
      );
      response.status(200).send(filteredUserObjects.map((user) => user.id));
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get User IDs");
    }
  }
}

module.exports = UserController;
