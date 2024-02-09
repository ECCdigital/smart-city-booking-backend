const BookableManager = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { Bookable } = require("../../../commons/entities/bookable");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const {
  getRelatedOpeningHours,
} = require("../../../commons/utilities/opening-hours-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "bookable-controlller.js",
  level: process.env.LOG_LEVEL,
});

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
        "create",
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
        "readAny",
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
        "readOwn",
      ))
    )
      return true;

    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await UserManager.getUsersWithRoles(
          tenant,
          bookable.permittedRoles || [],
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
        "updateAny",
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
        "updateOwn",
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
        "deleteAny",
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
        "deleteOwn",
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
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookables = await BookableManager.getBookables(tenant);

      if (request.query.populate === "true") {
        for (const bookable of bookables) {
          bookable._populated = {
            event: await EventManager.getEvent(
              bookable.eventId,
              bookable.tenant,
            ),
            relatedBookables: await BookableManager.getRelatedBookables(
              bookable.id,
              bookable.tenant,
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

      logger.info(
        `${tenant} -- Returning ${allowedBookables.length} bookables to user ${user?.id}`,
      );

      response.status(200).send(allowedBookables);
    } catch (err) {
      logger.error(err);
      response.status(500).send(`Could not get bookables`);
    }
  }

  static async getBookable(request, response) {
    try {
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
                bookable.tenant,
              ),
              relatedBookables: await BookableManager.getRelatedBookables(
                bookable.id,
                bookable.tenant,
              ),
            };
          }

          logger.info(
            `${tenant} -- Returning bookable ${bookable.id} to user ${user?.id}`,
          );
          response.status(200).send(bookable);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to read bookable ${id}`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(`${tenant} -- Could not get bookable. No id provided.`);
        response.status(400).send(`${tenant} -- No id provided`);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send(`Could not get bookable`);
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
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookable = Object.assign(new Bookable(), request.body);
      bookable.id = uuidv4();
      bookable.ownerUserId = user.id;

      if (
        await BookablePermissions._allowCreate(bookable, user.id, user.tenant)
      ) {
        await BookableManager.storeBookable(bookable);
        logger.info(
          `${tenant} -- Bookable ${bookable.id} created by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to create bookable`,
        );
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not create bookable");
    }
  }

  static async updateBookable(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookable = Object.assign(new Bookable(), request.body);

      if (
        await BookablePermissions._allowUpdate(bookable, user.id, user.tenant)
      ) {
        await BookableManager.storeBookable(bookable);
        logger.info(
          `${tenant} -- Bookable ${bookable.id} updated by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to update bookable`,
        );
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not update bookable");
    }
  }

  static async removeBookable(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (id) {
        const bookable = await BookableManager.getBookable(id, tenant);

        if (
          await BookablePermissions._allowDelete(bookable, user.id, user.tenant)
        ) {
          await BookableManager.removeBookable(id, tenant);
          logger.info(
            `${tenant} -- Bookable ${id} removed by user ${user?.id}`,
          );
          response.sendStatus(200);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to remove bookable`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(`${tenant} -- Could not remove bookable. No id provided.`);
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not remove bookable");
    }
  }

  static async getTags(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookables = await BookableManager.getBookables(tenant);
      const tags = bookables
        .map((b) => b.tags)
        .flat()
        .filter((value, index, self) => self.indexOf(value) === index);

      logger.info(
        `${tenant} -- Returning ${tags.length} tags to user ${user?.id}`,
      );
      response.status(200).send(tags);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get tags");
    }
  }

  static async getOpeningHours(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;

      if (id) {
        const bookable = await BookableManager.getBookable(id, tenant);
        {
          const openingHours = await getRelatedOpeningHours(
            bookable.id,
            tenant,
          );

          response.status(200).send(openingHours);
        }
      } else {
        logger.warn(
          `${tenant} -- Could not get opening hours. No id provided.`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get opening hours");
    }
  }
}

module.exports = BookableController;
