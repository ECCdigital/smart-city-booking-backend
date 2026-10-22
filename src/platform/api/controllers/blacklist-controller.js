const bunyan = require("bunyan");
const BlacklistService = require("../../../commons/services/blacklist/blacklist-service");

const logger = bunyan.createLogger({
  name: "blacklist-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The blacklist of the instance (glossary „Blacklist“,
 * ECCdigital/tickets#625), the instance owner's alone.
 */
class BlacklistController {
  static async getEntries(request, response, next) {
    try {
      response.status(200).send(await BlacklistService.list());
    } catch (error) {
      next(error);
    }
  }

  /** The accounts an entry of `?value=` would hit, before it is added. */
  static async getPreview(request, response, next) {
    try {
      response
        .status(200)
        .send(await BlacklistService.preview(request.query.value));
    } catch (error) {
      next(error);
    }
  }

  static async createEntry(request, response, next) {
    try {
      const entry = await BlacklistService.create({
        value: request.body?.value,
        reason: request.body?.reason,
        by: request.user.id,
      });
      logger.info(
        `Instance -- blacklisted ${entry.value} by user ${request.user.id}, suspended ${entry.suspendedUserIds.length} accounts`,
      );
      response.status(201).send(entry);
    } catch (error) {
      next(error);
    }
  }

  static async updateEntry(request, response, next) {
    try {
      response
        .status(200)
        .send(
          await BlacklistService.updateReason(
            request.params.id,
            request.body?.reason,
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  /** Removes an entry; `?unsuspend=true` lifts the suspensions it made. */
  static async removeEntry(request, response, next) {
    try {
      const result = await BlacklistService.remove(request.params.id, {
        unsuspend: request.query.unsuspend === "true",
      });
      logger.info(
        `Instance -- removed blacklist entry ${request.params.id} by user ${request.user.id}, lifted ${result.unsuspendedUserIds.length} suspensions`,
      );
      response.status(200).send(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BlacklistController;
