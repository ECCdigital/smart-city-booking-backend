const EventManager = require("../../../commons/data-managers/event-manager");
const { Event } = require("../../../commons/entities/event/event");
const bunyan = require("bunyan");
const EventService = require("../../../commons/services/event-service");
const BookingService = require("../../../commons/services/checkout/booking-service");
const MediaReferenceGuard = require("../../../commons/services/media/media-reference-guard");
const {
  BaseError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");
const { decide, scopeOf } = require("../../../commons/services/authorization");

const logger = bunyan.createLogger({
  name: "event-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Events.
 */
class EventController {
  static async getEvents(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const events = await EventManager.getEvents(tenant);

      //TODO: Add Public version of events

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
      const id = request.params.id;
      if (id) {
        const event = await EventManager.getEvent(id, tenant);

        //TODO: Add Public version of event

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
   * The booked seats of an event: all under reach `any`, under `own` the
   * seats of the user's own tickets.
   */
  static async getBookedSeatsCount(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;

      if (!id) {
        logger.warn(`Could not get booked seats count. Missing ID.`);
        return response.sendStatus(400);
      }

      const { reach, userId } = scopeOf(request);
      const count = await BookingService.getBookedSeatsCount(
        tenant,
        id,
        reach === "own" ? { onlyOwn: true, userId } : {},
      );
      response.status(200).send({ bookedSeats: count });
    } catch (err) {
      logger.warn(err);
      response.status(500).send("could not get booked seats count");
    }
  }

  /**
   * @obsolute Use createEvent and updateEvent instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeEvent(request, response) {
    const event = new Event(request.body);

    const isUpdate = !!event.id;

    if (isUpdate) {
      await EventController.updateEvent(request, response);
    } else {
      await EventController.createEvent(request, response);
    }
  }

  static async createEvent(request, response) {
    try {
      const {
        params: { tenant },
        user,
        body: event,
        query: { withTickets = "false" },
      } = request;

      const withTicketsBoolean = withTickets === "true";

      // The obsolete PUT carries the update marker; the creation is the
      // adapter's second decision (authorize spec §5, §11).
      if (decide(request.principal, "event", "create") !== "any") {
        logger.warn(`User ${user?.id} not allowed to create event`);
        throw new ForbiddenError();
      }

      if (
        (await EventManager.checkPublicEventCount(tenant)) === false &&
        event.isPublic
      ) {
        throw new Error(`Maximum number of  public  events reached.`);
      }

      await MediaReferenceGuard.assertEventStorable(event, tenant, user.id);
      await EventService.createEvent(tenant, event, user, withTicketsBoolean);

      logger.info(`${tenant} -- created event ${event.id} by user ${user?.id}`);
      response.sendStatus(201);
    } catch (err) {
      if (err instanceof BaseError) {
        logger.warn({ err: err.toJSON() }, `${err.name}: ${err.code}`);
        return response.status(err.statusCode).json(err.toJSON());
      }
      logger.error(err);
      response.status(500).send("could not create event");
    }
  }

  static async updateEvent(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const event = new Event(request.body);

      // The event within the reach of the request; none there is a 404.
      const existingEvent = await EventManager.getEvent(
        event.id,
        tenant,
        scopeOf(request),
      );
      if (!existingEvent) {
        throw new NotFoundError("event_not_found", { eventId: event.id });
      }

      if (!existingEvent.isPublic && event.isPublic) {
        if ((await EventManager.checkPublicEventCount(tenant)) === false) {
          throw new Error(`Maximum number of public events reached.`);
        }
      }

      await MediaReferenceGuard.assertEventStorable(event, tenant, user.id);
      await EventManager.storeEvent(event);
      logger.info(`${tenant} -- updated event ${event.id} by user ${user?.id}`);
      response.sendStatus(201);
    } catch (err) {
      if (err instanceof BaseError) {
        logger.warn({ err: err.toJSON() }, `${err.name}: ${err.code}`);
        return response.status(err.statusCode).json(err.toJSON());
      }
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
        const event = await EventManager.getEvent(id, tenant, scopeOf(request));
        if (!event) {
          return response.sendStatus(404);
        }

        await EventManager.removeEvent(id, tenant);
        logger.info(`${tenant} -- removed event ${id} by user ${user?.id}`);
        response.sendStatus(200);
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
