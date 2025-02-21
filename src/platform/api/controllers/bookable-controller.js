const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { Bookable } = require("../../../commons/entities/bookable");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role");
const PermissionService = require("../../../commons/services/permission-service");
const {
  getRelatedOpeningHours,
} = require("../../../commons/utilities/opening-hours-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "bookable-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Bookables.
 */
class BookableController {
  static async getPublicBookables(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const bookables = await BookableManager.getBookables(tenant);

      if (request.query.populate === "true") {
        for (const bookable of bookables) {
          bookable._populated = {
            event: await EventManager.getEvent(
              bookable.eventId,
              bookable.tenantId,
            ),
            relatedBookables: await BookableManager.getRelatedBookables(
              bookable.id,
              bookable.tenantId,
            ),
          };
        }
      }
      logger.info(
        `${tenant} -- Returning ${bookables.length} bookables to user ${user?.id}`,
      );

      response.status(200).send(bookables);
    } catch (err) {
      logger.error(err);
      response.status(500).send(`Could not get bookables`);
    }
  }
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

      const allowedBookables = [];

      for (const b of bookables) {
        if (
          await PermissionService._allowRead(
            b,
            user.id,
            tenant,
            RolePermission.MANAGE_BOOKABLES,
          )
        ) {
          allowedBookables.push(b);
        }
      }

      if (request.query.populate === "true") {
        for (const bookable of allowedBookables) {
          bookable._populated = {
            event: await EventManager.getEvent(
              bookable.eventId,
              bookable.tenantId,
            ),
            relatedBookables: await BookableManager.getRelatedBookables(
              bookable.id,
              bookable.tenantId,
            ),
          };
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

  static async getPublicBookable(request, response) {
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

      if (request.query.populate === "true") {
        bookable._populated = {
          event: await EventManager.getEvent(
            bookable.eventId,
            bookable.tenantId,
          ),
          relatedBookables: await BookableManager.getRelatedBookables(
            bookable.id,
            bookable.tenantId,
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

      console.log("id", id);

      if (!id) {
        logger.warn(`${tenant} -- Could not get bookable. No id provided.`);
        return response.status(400).send(`${tenant} -- No id provided`);
      }

      const bookable = await BookableManager.getBookable(id, tenant);
      if (!bookable) {
        logger.warn(`${tenant} -- Bookable with id ${id} not found.`);
        return response.status(404).send(`Bookable with id ${id} not found`);
      }

      if (
        !(await PermissionService._allowRead(
          bookable,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKABLES,
        ))
      ) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to read bookable ${id}`,
        );
        return response.sendStatus(403);
      }

      if (request.query.populate === "true") {
        bookable._populated = {
          event: await EventManager.getEvent(
            bookable.eventId,
            bookable.tenantId,
          ),
          relatedBookables: await BookableManager.getRelatedBookables(
            bookable.id,
            bookable.tenantId,
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
    const bookable = new Bookable(request.body);
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

      const bookable = new Bookable(request.body);
      bookable.id = uuidv4();
      bookable.ownerUserId = user.id;

      if (
        (await BookableManager.checkPublicBookableCount(bookable.tenantId)) ===
          false &&
        bookable.isPublic
      ) {
        throw new Error(`Maximum number of public bookables reached.`);
      }

      if (
        await PermissionService._allowCreate(
          bookable,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKABLES,
        )
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

      const bookable = new Bookable(request.body);

      const existingBookable = await BookableManager.getBookable(
        bookable.id,
        tenant,
      );

      if (!existingBookable.isPublic && bookable.isPublic) {
        if (
          (await BookableManager.checkPublicBookableCount(
            bookable.tenantId,
          )) === false
        ) {
          throw new Error(`Maximum number of public bookables reached.`);
        }
      }

      if (
        await PermissionService._allowUpdate(
          bookable,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKABLES,
        )
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

        if (
          await PermissionService._allowDelete(
            bookable,
            user.id,
            tenant,
            RolePermission.MANAGE_BOOKABLES,
          )
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
