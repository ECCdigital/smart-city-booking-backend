const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user/user");
const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const { RolePermission } = require("../../../commons/entities/role/role");
const UserModel = require("../../../commons/data-managers/models/userModel");
const BookingModel = require("../../../commons/data-managers/models/bookingModel");
const GroupBookingModel = require("../../../commons/data-managers/models/groupBookingModel");

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
  static async _findRawUserByIdOrKeycloak(userId, keycloakId = null) {
    const normalizedUserId = String(userId || "").trim().toLowerCase();
    const normalizedKeycloakId = String(keycloakId || "").trim();

    let rawUser = null;
    if (normalizedUserId) {
      rawUser = await UserModel.findOne({ id: normalizedUserId });
      if (!rawUser) {
        rawUser = await UserModel.findOne({
          id: { $regex: `^${normalizedUserId}$`, $options: "i" },
        });
      }
    }

    if (!rawUser && normalizedKeycloakId) {
      rawUser = await UserModel.findOne({ keycloakId: normalizedKeycloakId });
    }

    return rawUser;
  }

  static async _allowSyncManageUsers(actorId, tenantId, action = "update") {
    const normalizedActorId = String(actorId || "").trim().toLowerCase();
    const normalizedTenantId = String(tenantId || "").trim();

    if (!normalizedActorId || !normalizedTenantId) {
      return false;
    }

    if (await PermissionService._isInstanceOwner(normalizedActorId)) {
      return true;
    }
    if (
      await PermissionService._isTenantOwner(
        normalizedActorId,
        normalizedTenantId,
      )
    ) {
      return true;
    }

    const accessLevel = action === "delete" ? "deleteAny" : "updateAny";
    return await UserManager.hasPermission(
      normalizedActorId,
      normalizedTenantId,
      RolePermission.MANAGE_USERS,
      accessLevel,
    );
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
        await UserManager.updateUser(newInfos);
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
      const tenantId = request.query.tenant || request.body?.tenantId;
      const normalizedCurrentId = String(currentId || "").trim().toLowerCase();
      const normalizedNewId = String(newId || "").trim().toLowerCase();
      const normalizedKeycloakId = String(keycloakId || "").trim();

      if (!normalizedNewId) {
        response.status(400).send("Missing required parameters");
        return;
      }

      const currentUser = await UserController._findRawUserByIdOrKeycloak(
        normalizedCurrentId,
        normalizedKeycloakId,
      );
      if (!currentUser) {
        response.status(404).send("User not found");
        return;
      }

      const previousId = currentUser.id;

      const hasUserUpdatePermission = await UserPermissions._allowUpdate(
        { id: previousId },
        actor.id,
      );
      const hasSyncManagePermission = await UserController._allowSyncManageUsers(
        actor.id,
        tenantId,
        "update",
      );

      if (!hasUserUpdatePermission && !hasSyncManagePermission) {
        logger.warn(`User ${actor?.id} not allowed to change user id`);
        response.sendStatus(403);
        return;
      }

      if (previousId !== normalizedNewId) {
        const existingTargetUser = await UserModel.findOne({ id: normalizedNewId });
        if (
          existingTargetUser &&
          String(existingTargetUser._id) !== String(currentUser._id)
        ) {
          response.status(409).send("Target user id already exists");
          return;
        }
      }

      const userSet = {};
      if (previousId !== normalizedNewId) {
        userSet.id = normalizedNewId;
      }
      if (normalizedKeycloakId) {
        userSet.keycloakId = normalizedKeycloakId;
      }
      if (anonymize === true) {
        userSet.firstName = "Deleted";
        userSet.lastName = "";
      }
      if (Object.keys(userSet).length > 0) {
        await UserModel.updateOne({ _id: currentUser._id }, { $set: userSet });
      }

      if (previousId !== normalizedNewId) {
        await BookingModel.updateMany(
          { assignedUserId: previousId },
          { $set: { assignedUserId: normalizedNewId } },
        );
        await BookingModel.updateMany(
          { mail: previousId },
          { $set: { mail: normalizedNewId } },
        );
        await GroupBookingModel.updateMany(
          { assignedUserId: previousId },
          { $set: { assignedUserId: normalizedNewId } },
        );
        await GroupBookingModel.updateMany(
          { mail: previousId },
          { $set: { mail: normalizedNewId } },
        );
      }

      logger.info(
        `changed user id ${previousId} -> ${normalizedNewId} by user ${actor?.id}`,
      );
      response.status(200).send({
        previousId,
        id: normalizedNewId,
        changed: previousId !== normalizedNewId,
      });
    } catch (error) {
      logger.error(error);
      response
        .status(error.status || 500)
        .send(error.message || "could not change user id");
    }
  }

  /**
   * Updates first and last name of a user.
   */
  static async updateUserNames(request, response) {
    try {
      const actor = request.user;
      const userId = request.params.id;
      const { firstName, lastName, keycloakId = null } = request.body;
      const tenantId = request.query.tenant || request.body?.tenantId;
      const normalizedUserId = String(userId || "").trim().toLowerCase();
      const normalizedKeycloakId = String(keycloakId || "").trim();
      const normalizedFirstName = (firstName || "").trim();
      const normalizedLastName = (lastName || "").trim();

      if (!normalizedFirstName || !normalizedLastName) {
        response.status(400).send("Missing required parameters");
        return;
      }

      const currentUser = await UserController._findRawUserByIdOrKeycloak(
        normalizedUserId,
        normalizedKeycloakId,
      );
      if (!currentUser) {
        response.status(404).send("User not found");
        return;
      }

      const hasUserUpdatePermission = await UserPermissions._allowUpdate(
        { id: currentUser.id },
        actor.id,
      );
      const hasSyncManagePermission = await UserController._allowSyncManageUsers(
        actor.id,
        tenantId,
        "update",
      );

      if (!hasUserUpdatePermission && !hasSyncManagePermission) {
        logger.warn(`User ${actor?.id} not allowed to update user names`);
        response.sendStatus(403);
        return;
      }

      const updated = await UserModel.findOneAndUpdate(
        { _id: currentUser._id },
        {
          $set: {
            firstName: normalizedFirstName,
            lastName: normalizedLastName,
            ...(normalizedKeycloakId ? { keycloakId: normalizedKeycloakId } : {}),
          },
        },
        { new: true },
      );
      if (!updated) {
        response.status(404).send("User not found");
        return;
      }

      logger.info(`updated user names for ${updated.id} by user ${actor?.id}`);
      response.status(200).send({
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
      });
    } catch (error) {
      logger.error(error);
      response
        .status(error.status || 500)
        .send(error.message || "could not update user names");
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
      const syncTenantId = request.query.tenant || request.body?.tenantId;

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
        const hasSyncManagePermission = await UserController._allowSyncManageUsers(
          user.id,
          syncTenantId,
          "delete",
        );

        if (hasUserDeletePermission || hasSyncManagePermission) {
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
