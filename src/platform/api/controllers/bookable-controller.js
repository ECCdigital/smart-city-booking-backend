const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { Bookable } = require("../../../commons/entities/bookable");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const {getRelatedOpeningHours} = require("../../../commons/utilities/opening-hours-manager");

class BookablePermissions {
  static _isOwner(bookable, userId, tenant) {
    return bookable.ownerUserId === userId && bookable.tenant === tenant;
  }

  static async _allowCreate(bookable, userId, tenant) {
    return (
      bookable.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "create"
      ))
    );
  }

  static async _allowRead(bookable, userId, tenant) {
    if (
      bookable.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readAny"
      ))
    )
      return true;

    if (
      bookable.tenant === tenant &&
      BookablePermissions._isOwner(bookable, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readOwn"
      ))
    )
      return true;

    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await UserManager.getUsersWithRoles(
          tenant,
          bookable.permittedRoles || []
        )
      ).map((u) => u.id),
    ];

    if (permittedUsers.length > 0 && !permittedUsers.includes(userId)) {
      return false;
    }

    return true;
  }

  static async _allowUpdate(bookable, userId, tenant) {
    if (
      bookable.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateAny"
      ))
    )
      return true;

    if (
      bookable.tenant === tenant &&
      BookablePermissions._isOwner(bookable, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateOwn"
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(bookable, userId, tenant) {
    if (
      bookable.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "deleteAny"
      ))
    )
      return true;

    if (
      bookable.tenant === tenant &&
      BookablePermissions._isOwner(bookable, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "deleteOwn"
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Bookables.
 */
class BookableController {
  static async getBookables(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const bookables = await BookableManager.getBookables(tenant);

    if (request.query.populate === "true") {
      for (const bookable of bookables) {
        bookable._populated = {
          event: await EventManager.getEvent(bookable.eventId, bookable.tenant),
          relatedBookables: await BookableManager.getRelatedBookables(
            bookable.id,
            bookable.tenant
          ),
        };
      }
    }

    let allowedBookables = [];
    for (const bookable of bookables) {
      if (
        await BookablePermissions._allowRead(bookable, user?.id, user?.tenant)
      ) {
        allowedBookables.push(bookable);
      }
    }

    response.status(200).send(allowedBookables);
  }

  static async getBookable(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const id = request.params.id;
    if (id) {
      const bookable = await BookableManager.getBookable(id, tenant);

      if (
        await BookablePermissions._allowRead(bookable, user?.id, user?.tenant)
      ) {
        if (request.query.populate === "true") {
          bookable._populated = {
            event: await EventManager.getEvent(
              bookable.eventId,
              bookable.tenant
            ),
            relatedBookables: await BookableManager.getRelatedBookables(
              bookable.id,
              bookable.tenant
            ),
          };
        }

        response.status(200).send(bookable);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }

  /**
   * @obsolete User createBookable or updateBookable instead
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeBookable(request, response) {
    const bookable = Object.assign(new Bookable(), request.body);
    const isUpdate = !!bookable.id;

    if (isUpdate) {
      await BookableController.updateBookable(request, response);
    } else {
      await BookableController.createBookable(request, response);
    }
  }

  static async createBookable(request, response) {
    const user = request.user;

    const bookable = Object.assign(new Bookable(), request.body);
    bookable.id = uuidv4();
    bookable.ownerUserId = user.id;

    if (
      await BookablePermissions._allowCreate(bookable, user.id, user.tenant)
    ) {
      await BookableManager.storeBookable(bookable);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateBookable(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const bookable = Object.assign(new Bookable(), request.body);

    if (
      await BookablePermissions._allowUpdate(bookable, user.id, user.tenant)
    ) {
      await BookableManager.storeBookable(bookable);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeBookable(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const id = request.params.id;

    if (id) {
      const bookable = await BookableManager.getBookable(id, tenant);

      if (
        await BookablePermissions._allowDelete(bookable, user.id, user.tenant)
      ) {
        await BookableManager.removeBookable(id, tenant);
        response.sendStatus(200);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }

  static async getTags(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const bookables = await BookableManager.getBookables(tenant);
    const tags = bookables
      .map((b) => b.tags)
      .flat()
      .filter((value, index, self) => self.indexOf(value) === index);

    response.status(200).send(tags);
  }

  static async getOpeningHours(request, response) {
    const tenant = request.params.tenant;
    const id = request.params.id;

    if (id) {
      const bookable = await BookableManager.getBookable(id, tenant);
       {
        const openingHours = await getRelatedOpeningHours(
          bookable.id,
            tenant
        );

        response.status(200).send(openingHours);
      }
    } else {
      response.sendStatus(400);
    }
  }
}

module.exports = BookableController;
