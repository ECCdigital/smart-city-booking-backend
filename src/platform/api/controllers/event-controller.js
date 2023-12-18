const EventManager = require("../../../commons/data-managers/event-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
const { Event } = require("../../../commons/entities/event");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");

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
        "create"
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
        "readAny"
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
        "readOwn"
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
        "updateAny"
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
        "updateOwn"
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
        "deleteAny"
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
class EventController {
  static async getEvents(request, response) {
    const tenant = request.params.tenant;
    const events = await EventManager.getEvents(tenant);
    response.status(200).send(events);
  }

  static async getEvent(request, response) {
    const tenant = request.params.tenant;
    const id = request.params.id;
    if (id) {
      const event = await EventManager.getEvent(id, tenant);
      response.status(200).send(event);
    } else {
      response.sendStatus(400);
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
    const tenant = request.params.tenant;
    const user = request.user;
    const event = Object.assign(new Event(), request.body);

    event.id = uuidv4();
    event.ownerUserId = user.id;

    if (await EventPermissions._allowCreate(event, user.id, tenant)) {
      await EventManager.storeEvent(event);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateEvent(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const event = Object.assign(new Event(), request.body);

    if (await EventPermissions._allowUpdate(event, user.id, user.tenant)) {
      await EventManager.storeEvent(event);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeEvent(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const id = request.params.id;
    if (id) {
      const event = await EventManager.getEvent(id, tenant);

      if (await EventPermissions._allowDelete(event, user.id, user.tenant)) {
        await EventManager.removeEvent(id, tenant);
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

    const events = await EventManager.getEvents(tenant);
    const tags = events
      .map((e) => e.information?.tags || [])
      .flat()
      .filter((value, index, self) => self.indexOf(value) === index);

    response.status(200).send(tags);
  }
}

module.exports = EventController;
