const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
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
  name: "bookable-controller.js",
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
  /**
   * This method is used to get all bookable objects for a specific tenant.
   * It first fetches all bookables from the database.
   * If the 'populate' query parameter is set to 'true', it populates each bookable with related data.
   * Then it filters out the bookables that the user is not allowed to read.
   * Finally, it sends the allowed bookables back with a 200 status code.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
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
        if (await BookablePermissions._allowRead(bookable, user?.id, tenant)) {
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

  /**
   * This method is used to get a specific bookable object.
   * It first checks if the bookable id is provided in the request.
   * If not, it sends a 400 status code with an error message.
   * If the id is provided, it tries to fetch the bookable from the database.
   * If the bookable is not found, it sends a 404 status code with an error message.
   * If the bookable is found, it checks if the user is allowed to read the bookable.
   * If the user is not allowed, it sends a 403 status code.
   * If the user is allowed, it populates the bookable with related data if requested,
   * and sends the bookable back with a 200 status code.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async getBookable(request, response) {
    const tenant = request.params.tenant;
    try {
      const user = request.user;
      const id = request.params.id;

      if (!id) {
        logger.warn(`${tenant} -- Could not get bookable. No id provided.`);
        return response.status(400).send(`${tenant} -- No id provided`);
      }

      const bookable = await BookableManager.getBookable(id, tenant);
      if (!bookable) {
        logger.warn(`${tenant} -- Bookable with id ${id} not found.`);
        return response.status(404).send(`Bookable with id ${id} not found`);
      }

      const hasPermittedUsers =
        bookable.permittedUsers && bookable.permittedUsers.length > 0;
      if (hasPermittedUsers && !user?.id) {
        logger.warn(
          `${tenant} -- Authentication required to access bookable ${id}`,
        );
        return response.status(401).send("Authentication required");
      }

      const hasPermittedRoles =
        bookable.permittedRoles && bookable.permittedRoles.length > 0;
      if (hasPermittedRoles && !user?.id) {
        logger.warn(
          `${tenant} -- Authentication required to access bookable ${id}`,
        );
        return response.status(401).send("Authentication required");
      }

      const isAllowed = await BookablePermissions._allowRead(
        bookable,
        user?.id,
        tenant,
      );
      if (!isAllowed) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to read bookable ${id}`,
        );
        return response.sendStatus(403);
      }

      if (request.query.populate === "true") {
        bookable._populated = {
          event: await EventManager.getEvent(bookable.eventId, bookable.tenant),
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
    } catch (err) {
      logger.error(`${tenant} -- ${err.message}`);
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

  /**
   * This method is used to create a new bookable object.
   * It first creates a new bookable object from the request body and assigns a unique id and the user id to it.
   * Then it checks if the maximum number of public bookables has been reached, if the bookable is public.
   * If the maximum number has been reached, it throws an error.
   * If the maximum number has not been reached, it checks if the user is allowed to create the bookable.
   * If the user is allowed, it stores the bookable in the database and sends a 201 status code.
   * If the user is not allowed, it sends a 403 status code.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async createBookable(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookable = Object.assign(new Bookable(), request.body);
      bookable.id = uuidv4();
      bookable.ownerUserId = user.id;

      if (
        (await BookableManager.checkPublicBookableCount(bookable.tenant)) ===
          false &&
        bookable.isPublic
      ) {
        throw new Error(`Maximum number of public bookables reached.`);
      }

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

  /**
   * This method is used to update an existing bookable object.
   * It first fetches the existing bookable from the database.
   * If the existing bookable is private and the updated bookable is public, it checks if the maximum number of public bookables has been reached.
   * If the maximum number has been reached, it throws an error.
   * If the maximum number has not been reached, it checks if the user is allowed to update the bookable.
   * If the user is allowed, it updates the bookable in the database and sends a 201 status code.
   * If the user is not allowed, it sends a 403 status code.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async updateBookable(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookable = Object.assign(new Bookable(), request.body);

      const existingBookable = await BookableManager.getBookable(
        bookable.id,
        tenant,
      );

      if (!existingBookable.isPublic && bookable.isPublic) {
        if (
          (await BookableManager.checkPublicBookableCount(bookable.tenant)) ===
          false
        ) {
          throw new Error(`Maximum number of public bookables reached.`);
        }
      }

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

  /**
   * This method is used to update an existing bookable object.
   * It first fetches the existing bookable from the database.
   * If the existing bookable is private and the updated bookable is public, it checks if the maximum number of public bookables has been reached.
   * If the maximum number has been reached, it throws an error.
   * If the maximum number has not been reached, it checks if the user is allowed to update the bookable.
   * If the user is allowed, it updates the bookable in the database and sends a 201 status code.
   * If the user is not allowed, it sends a 403 status code.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async removeBookable(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (id) {
        const bookable = await BookableManager.getBookable(id, tenant);

        if (await BookablePermissions._allowDelete(bookable, user.id, tenant)) {
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

  /**
   * This method is used to get all unique tags from all bookable objects for a specific tenant.
   * It first fetches all bookables from the database.
   * Then it extracts all tags from each bookable, flattens the array and filters out duplicates.
   * Finally, it sends the unique tags back with a 200 status code.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
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

  /**
   * This method is used to get the opening hours of a specific bookable object.
   * It first checks if the bookable id is provided in the request.
   * If not, it sends a 400 status code with an error message.
   * If the id is provided, it fetches the bookable from the database.
   * Then it fetches the related opening hours for the bookable.
   * Finally, it sends the opening hours back with a 200 status code.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
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

  /**
   * This method is used to check if the creation of a new bookable object is allowed.
   * It first gets the tenant from the request parameters.
   * Then it checks if the maximum number of public bookables for the tenant has been reached using the BookableManager.
   * If the maximum number has not been reached, it sends a 200 status code with the response 'true'.
   * If the maximum number has been reached, it sends a 200 status code with the response 'false'.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async countCheck(request, response) {
    try {
      const tenant = request.params.tenant;
      const isCreateAllowed =
        await BookableManager.checkPublicBookableCount(tenant);
      response.status(200).send(isCreateAllowed);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not check if creation is possible");
    }
  }
}

module.exports = BookableController;
