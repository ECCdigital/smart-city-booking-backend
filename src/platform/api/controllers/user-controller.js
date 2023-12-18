const EventManager = require("../../../commons/data-managers/event-manager");
const UserManager = require("../../../commons/data-managers/user-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
const { User } = require("../../../commons/entities/user");
const { RolePermission } = require("../../../commons/entities/role");

class UserPermissions {
  static _isSelf(user, userId, userTenant) {
    return user.id === userId && user.tenant === userTenant;
  }

  static async _allowCreate(user, userId, tenant) {
    return await UserManager.hasPermission(
      userId,
      tenant,
      RolePermission.MANAGE_USERS,
      "create"
    );
  }

  static async _allowRead(user, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "readAny"
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
        "readOwn"
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
        "updateAny"
      )
    )
      return true;

    if (
      UserPermissions._isSelf(user, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "updateOwn"
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
        "deleteAny"
      )
    )
      return true;

    if (
      UserPermissions._isSelf(user, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_USERS,
        "deleteOwn"
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
    const tenant = request.params.tenant;
    const user = request.user;

    const userObjects = await UserManager.getUsers(tenant);

    const allowedUserObjects = [];
    for (const userObject of userObjects) {
      if (await UserPermissions._allowRead(userObject, user.id, user.tenant)) {
        allowedUserObjects.push(userObject);
      }
    }

    response.status(200).send(allowedUserObjects);
  }

  static async getUser(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const id = request.params.id;

    if (id) {
      if (await UserPermissions._allowRead(user, user.id, user.tenant)) {
        const userObject = await UserManager.getUser(id, tenant);
        response.status(200).send(userObject);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
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
    const user = request.user;

    const userObject = Object.assign(new User(), request.body);

    if (await UserPermissions._allowCreate(userObject, user.id, user.tenant)) {
      await UserManager.storeUser(userObject);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateUser(request, response) {
    const user = request.user;

    const userObject = Object.assign(new User(), request.body);

    if (await UserPermissions._allowUpdate(userObject, user.id, user.tenant)) {
      await UserManager.storeUser(userObject);
      response.sendStatus(200);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeUser(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const id = request.params.id;
    if (id) {
      const userObject = await UserManager.getUser(id, tenant);

      if (
        await UserPermissions._allowDelete(userObject, user.id, user.tenant)
      ) {
        await UserManager.deleteUser(id, tenant);
        response.sendStatus(200);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }
  // Allows only to change the display name
  static updateMe(request, response) {
    const user = Object.assign(new User(), request.user);
    // get user from db
    UserManager.getUser(user.id, user.tenant)
      .then((userFromDb) => {
        //check if user exists
        if (userFromDb) {
          if (user.id === userFromDb.id) {
            if (request.body.firstName && request.body.lastName) {
              userFromDb.firstName = request.body.firstName;
              userFromDb.lastName = request.body.lastName;
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
                    userFromDb.tenant
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
    const tenant = request.params.tenant;
    const userObjects = await UserManager.getUsers(tenant);
    response.status(200).send(userObjects.map((user) => user.id));
  }
}

module.exports = UserController;
