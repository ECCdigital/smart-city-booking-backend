const EventManager = require("../../../commons/data-managers/event-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
const { Event } = require("../../../commons/entities/event");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "event-controller.js",
  level: process.env.LOG_LEVEL,
});

class EventPermissions {
  static _isOwner(event, userId, tenant) {
    return event.ownerUserId === userId && event.tenant === tenant;
  }

  static async _allowCreate(event, userId, tenant) {
    return (
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "create",
      ))
    );
  }

  static async _allowRead(event, userId, tenant) {
    if (
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readAny",
      ))
    )
      return true;

    if (
      event.tenant === tenant &&
      EventPermissions._isOwner(event, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "readOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(event, userId, tenant) {
    if (
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateAny",
      ))
    )
      return true;

    if (
      event.tenant === tenant &&
      EventPermissions._isOwner(event, userId, tenant) &&
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

  static async _allowDelete(event, userId, tenant) {
    if (
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "deleteAny",
      ))
    )
      return true;

    if (
      event.tenant === tenant &&
      EventPermissions._isOwner(event, userId, tenant) &&
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
 * Web Controller for Events.
 */
class EventController {
  static async getEvents(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const events = await EventManager.getEvents(tenant);
      logger.info(
        `${tenant} -- sending ${events.length} events to user ${user?.id}`,
      );
      response.status(200).send(events);
    } catch (err) {
      logger.warn(err);
      response.status(500).send("could not get events");
    }
  }

  static async getEvent(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;
      if (id) {
        const event = await EventManager.getEvent(id, tenant);
        logger.info(
          `${tenant} -- sending event ${event.id} to user ${user?.id}`,
        );
        response.status(200).send(event);
      } else {
        logger.warn(`Could not get event. Missing ID.`);
        response.sendStatus(400);
      }
    } catch (err) {
      logger.warn(err);
      response.status(500).send("could not get event");
    }
  }

  /**
   * @obsolute Use createEvent and updateEvent instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeEvent(request, response) {
    const event = Object.assign(new Event(), request.body);

    const isUpdate = !!event.id;

    if (isUpdate) {
      await EventController.updateEvent(request, response);
    } else {
      await EventController.createEvent(request, response);
    }
  }

  static async createEvent(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const event = Object.assign(new Event(), request.body);

      event.id = uuidv4();
      event.ownerUserId = user?.id;

      if (await EventPermissions._allowCreate(event, user.id, tenant)) {
        await EventManager.storeEvent(event);
        logger.info(
          `${tenant} -- created event ${event.id} by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to create event`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not create event");
    }
  }

  static async updateEvent(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const event = Object.assign(new Event(), request.body);

      if (await EventPermissions._allowUpdate(event, user.id, user.tenant)) {
        await EventManager.storeEvent(event);
        logger.info(
          `${tenant} -- updated event ${event.id} by user ${user?.id}`,
        );
        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to update event`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not update event");
    }
  }

  static async removeEvent(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const id = request.params.id;
      if (id) {
        const event = await EventManager.getEvent(id, tenant);

        if (await EventPermissions._allowDelete(event, user.id, user.tenant)) {
          await EventManager.removeEvent(id, tenant);
          logger.info(`${tenant} -- removed event ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(`User ${user?.id} not allowed to remove event`);
          response.sendStatus(403);
        }
      } else {
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not remove event");
    }
  }

  static async getTags(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const events = await EventManager.getEvents(tenant);
      const tags = events
        .map((e) => e.information?.tags || [])
        .flat()
        .filter((value, index, self) => self.indexOf(value) === index);

      logger.info(
        `${tenant} -- sending ${tags.length} tags to user ${user?.id}`,
      );
      response.status(200).send(tags);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get tags");
    }
  }
  static async countCheck(request, response) {
    try {
      const tenant = request.params.tenant;
      const isCreateAllowed = await EventManager.checkPublicEventCount(tenant);
      response.status(200).send(isCreateAllowed);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not check if creation is possible");
    }
  }
}

module.exports = EventController;
