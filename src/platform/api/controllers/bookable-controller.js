const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { Bookable } = require("../../../commons/entities/bookable/bookable");
const { v4: uuidv4 } = require("uuid");
const AccessPointManager = require("../../../commons/data-managers/access-point-manager");
const { ValidationError } = require("../../../errors/ValidationError");
const { BaseError, ForbiddenError } = require("../../../errors/BaseError");
const {
  decide,
  scopeOf,
  scopeFor,
} = require("../../../commons/services/authorization");
const {
  getRelatedOpeningHours,
} = require("../../../commons/utilities/opening-hours-manager");
const BookableService = require("../../../commons/services/bookable-service");
const MediaReferenceGuard = require("../../../commons/services/media/media-reference-guard");
const {
  withLockerDetails,
} = require("../../../commons/services/access/bookable-locker-details");
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
        `${tenant} -- Returning ${bookables.length} public bookables to user ${user?.id}`,
      );

      response.status(200).send(
        await withLockerDetails(
          tenant,
          bookables.map((bookable) => bookable.withResolvedMediaUrls()),
        ),
      );
    } catch (err) {
      logger.error(err);
      response.status(500).send(`Could not get bookables`);
    }
  }
  /**
   * This method is used to get all bookable objects for a specific tenant.
   * It first fetches all bookables from the database.
   * The reach of the request is the query's condition (authorize spec §4.1).
   * If the 'populate' query parameter is set to 'true', it populates each bookable with related data.
   * Finally, it sends the bookables back with a 200 status code.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async getBookables(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const allowedBookables = await BookableManager.getBookables(
        tenant,
        scopeOf(request),
      );

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

      response
        .status(200)
        .send(await withLockerDetails(tenant, allowedBookables));
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
      const [withDetails] = await withLockerDetails(tenant, [
        bookable.withResolvedMediaUrls(),
      ]);
      response.status(200).send(withDetails);
    } catch (err) {
      logger.error(`${tenant} -- ${err.message}`);
      response.status(500).send(`Could not get bookable`);
    }
  }

  /**
   * This method is used to get a specific bookable object.
   * It first checks if the bookable id is provided in the request.
   * If not, it sends a 400 status code with an error message.
   * If the id is provided, it tries to fetch the bookable within the reach of the request.
   * If the bookable is not found there, it sends a 404 status code with an error message.
   * If the bookable is found, it populates the bookable with related data if requested,
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

      const bookable = await BookableManager.getBookable(
        id,
        tenant,
        scopeOf(request),
      );
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
      const [withDetails] = await withLockerDetails(tenant, [bookable]);
      response.status(200).send(withDetails);
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
  static async storeBookable(request, response, next) {
    const bookable = new Bookable(request.body);
    const isUpdate = !!bookable.id;

    if (isUpdate) {
      await BookableController.updateBookable(request, response, next);
    } else {
      await BookableController.createBookable(request, response, next);
    }
  }

  /**
   * This method is used to create a new bookable object.
   * It first creates a new bookable object from the request body and assigns a unique id and the user id to it.
   * Then it checks if the maximum number of public bookables has been reached, if the bookable is public.
   * If the maximum number has been reached, it throws an error.
   * If the maximum number has not been reached, it stores the bookable in the database and sends a 201 status code.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * The route carries the update marker (the obsolete PUT stores both ways);
   * the creation is the adapter's second decision (authorize spec §5, §11)
   * and answers 403 without it.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async createBookable(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      if (decide(request.principal, "bookable", "create") !== "any") {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to create bookable`,
        );
        return next(new ForbiddenError());
      }

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

      await BookableController._validateAccessPointIds(bookable, tenant);
      BookableController._validateAccessBuffers(bookable);
      await MediaReferenceGuard.assertBookableStorable(
        bookable,
        scopeFor(request, "media", "read"),
      );
      await BookableManager.storeBookable(bookable);
      logger.info(
        `${tenant} -- Bookable ${bookable.id} created by user ${user?.id}`,
      );
      response.status(201).send(bookable);
    } catch (err) {
      logger.error(err);
      if (err instanceof BaseError) {
        return next(err);
      }
      if (err.statusCode) {
        return response.status(err.statusCode).send(err.message);
      }
      response.status(500).send("Could not create bookable");
    }
  }

  /**
   * This method is used to update an existing bookable object.
   * It first fetches the existing bookable within the reach of the request; none there is a 404.
   * If the existing bookable is private and the updated bookable is public, it checks if the maximum number of public bookables has been reached.
   * If the maximum number has been reached, it throws an error.
   * If the maximum number has not been reached, it updates the bookable in the database and sends a 201 status code.
   * If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   *
   * @param {Object} request - The HTTP request object, containing the parameters and body.
   * @param {Object} response - The HTTP response object, used to send the response back to the client.
   * @throws {Error} If an error occurs during the process, it logs the error and sends a 500 status code with an error message.
   */
  static async updateBookable(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const bookable = new Bookable(request.body);

      const existingBookable = await BookableManager.getBookable(
        bookable.id,
        tenant,
        scopeOf(request),
      );
      if (!existingBookable) {
        logger.warn(`${tenant} -- Bookable with id ${bookable.id} not found.`);
        return response
          .status(404)
          .send(`Bookable with id ${bookable.id} not found`);
      }

      if (!existingBookable.isPublic && bookable.isPublic) {
        if (
          (await BookableManager.checkPublicBookableCount(
            bookable.tenantId,
          )) === false
        ) {
          throw new Error(`Maximum number of public bookables reached.`);
        }
      }

      await BookableController._validateAccessPointIds(bookable, tenant);
      BookableController._validateAccessBuffers(bookable);
      await MediaReferenceGuard.assertBookableStorable(
        bookable,
        scopeFor(request, "media", "read"),
      );
      await BookableManager.storeBookable(bookable);
      logger.info(
        `${tenant} -- Bookable ${bookable.id} updated by user ${user?.id}`,
      );
      response.status(201).send(bookable);
    } catch (err) {
      logger.error(err);
      if (err instanceof BaseError) {
        return next(err);
      }
      if (err.statusCode) {
        return response.status(err.statusCode).send(err.message);
      }
      response.status(500).send("Could not update bookable");
    }
  }

  /**
   * Validates that every referenced access point exists for the tenant. A
   * bookable may only point at access points of its own tenant, and a dangling
   * reference would silently be a door that never opens.
   *
   * @param {Bookable} bookable The bookable to be stored
   * @param {string} tenant The tenant of the request
   * @throws {ValidationError} If the tenant has no access point for an id
   */
  static async _validateAccessPointIds(bookable, tenant) {
    const accessPointIds = bookable.accessPointDetails?.accessPointIds || [];

    if (accessPointIds.length === 0) {
      return;
    }

    const accessPoints = await AccessPointManager.getAccessPointsByIds(
      tenant,
      accessPointIds,
    );
    const knownIds = new Set(
      accessPoints.map((accessPoint) => String(accessPoint.id)),
    );

    const errors = accessPointIds
      .filter((accessPointId) => !knownIds.has(String(accessPointId)))
      .map((accessPointId) => ({
        field: "accessPointDetails.accessPointIds",
        code: "unknown_access_point",
        params: { accessPointId: accessPointId },
      }));

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
  }

  /**
   * Validates the access buffer configuration (lead/lag time around a booking
   * during which an access point can still be operated). The buffer is
   * configured once per bookable (`accessPointDetails.accessBuffer`) and applies
   * to all of its access points. Values must be non-negative integers (minutes)
   * and must not exceed the configurable maximum
   * (`ACCESS_MAX_BUFFER_MINUTES`, default 1440).
   */
  static _validateAccessBuffers(bookable) {
    const details = bookable.accessPointDetails;

    if (!details?.active) {
      return;
    }

    const maxMinutes = Number(process.env.ACCESS_MAX_BUFFER_MINUTES) || 1440;

    const validate = (buffer, context) => {
      if (buffer === undefined || buffer === null) {
        return;
      }

      for (const key of ["before", "after"]) {
        const rawValue = buffer[key];

        if (rawValue === undefined || rawValue === null || rawValue === "") {
          continue;
        }

        const value = Number(rawValue);

        if (!Number.isInteger(value) || value < 0 || value > maxMinutes) {
          const err = new Error(
            `Invalid access buffer '${key}' (${rawValue}) for ${context}. ` +
              `Expected an integer between 0 and ${maxMinutes} minutes.`,
          );
          err.statusCode = 400;
          throw err;
        }

        // Normalize to a number so downstream logic never deals with strings.
        buffer[key] = value;
      }
    };

    validate(details.accessBuffer, "bookable default");
  }

  /**
   * This method removes a bookable. It fetches the bookable within the reach of the request;
   * none there is a 404. Then it removes the bookable and sends a 200 status code.
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
        const bookable = await BookableManager.getBookable(
          id,
          tenant,
          scopeOf(request),
        );
        if (!bookable) {
          logger.warn(`${tenant} -- Bookable with id ${id} not found.`);
          return response.status(404).send(`Bookable with id ${id} not found`);
        }

        await BookableManager.removeBookable(id, tenant);
        logger.info(`${tenant} -- Bookable ${id} removed by user ${user?.id}`);
        response.sendStatus(200);
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

  static async getBookableOccupancy(request, response) {
    try {
      const { tenant: tenantId, id: bookableId } = request.params;
      const {
        timeBegin,
        timeEnd,
        ignoreRelatedEntities: rawIgnoreRelatedEntities,
      } = request.query;
      const user = request.user;
      const ignoreRelatedEntities = rawIgnoreRelatedEntities === "true";

      if (!bookableId) {
        logger.warn(
          `${tenantId} -- Could not get bookable occupancy. No id provided.`,
        );
        return response.status(400).send(`${tenantId} -- No id provided`);
      }

      const occupancy = await BookableService.getOccupancy({
        bookableId,
        tenantId,
        timeBegin,
        timeEnd,
        userId: user?.id,
        ignoreRelatedEntities,
      });

      response.status(200).send(occupancy);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get bookable occupancy");
    }
  }

  static async getBookablePriceCategories(request, response) {
    try {
      const { tenant: tenantId, id: bookableId } = request.params;

      if (!bookableId) {
        logger.warn(
          `${tenantId} -- Could not get bookable price categories. No id provided.`,
        );
        return response.status(400).send(`${tenantId} -- No id provided`);
      }

      const bookable = await BookableManager.getBookable(bookableId, tenantId);
      if (!bookable) {
        logger.warn(`${tenantId} -- Bookable with id ${bookableId} not found.`);
        return response
          .status(404)
          .send(`Bookable with id ${bookableId} not found`);
      }

      if (!bookable.isPublic) {
        logger.warn(
          `${tenantId} -- Bookable with id ${bookableId} is not public.`,
        );
        return response
          .status(403)
          .send(`Bookable with id ${bookableId} is not public`);
      }

      const priceCategories =
        await BookableService.getPriceCategoriesForBookable(
          bookableId,
          tenantId,
        );

      response.status(200).send(priceCategories);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get bookable price categories");
    }
  }

  static async getBookableTemplate(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const defs = await BookableManager.getCustomFieldDefinitions(tenant);

      const template = new Bookable({ tenantId: tenant });

      template.enrichCustomFields(defs);

      logger.info(
        `${tenant} -- Returning bookable template to user ${user?.id}`,
      );

      response.status(200).send(template);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get bookable template");
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
