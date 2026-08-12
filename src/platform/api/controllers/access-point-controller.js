const AccessPointManager = require("../../../commons/data-managers/access-point-manager");
const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const {
  AccessPoint,
} = require("../../../commons/entities/access/access-point");
const AccessQrService = require("../../../commons/services/access/access-qr-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionService = require("../../../commons/services/permission-service");
const createComponentLogger = require("../../../middleware/logger");

const logger = createComponentLogger("access-point-controller.js");

const WRITABLE_FIELDS = [
  "label",
  "type",
  "provider",
  "externalId",
  "providerLocationId",
  "mode",
  "config",
  "location",
  "validationRules",
];

/**
 * Web Controller for the access point management API. Reading is open to
 * everyone who may read bookables, writing is reserved for tenant owners.
 */
class AccessPointController {
  static async getAccessPoints(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      if (!(await AccessPointController._canRead(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to read access points`,
        );
        return response.sendStatus(403);
      }

      const accessPoints = await AccessPointManager.getAccessPoints(tenantId);

      logger.info(
        `${tenantId} -- Sending ${accessPoints.length} access points to user ${user?.id}`,
      );
      return response
        .status(200)
        .send(accessPoints.map((accessPoint) => accessPoint.toResponse()));
    } catch (err) {
      return next(err);
    }
  }

  static async getAccessPoint(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      if (!(await AccessPointController._canRead(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to read access points`,
        );
        return response.sendStatus(403);
      }

      const accessPoint = await AccessPointManager.getAccessPoint(
        request.params.id,
        tenantId,
      );

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      return response.status(200).send(accessPoint.toResponse());
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Upsert an access point: an `id` in the body updates that access point,
   * a body without `id` creates a new one with a server-side id. An `id` the
   * tenant does not know is answered with 404 rather than created, so ids
   * always come from the server.
   */
  static async storeAccessPoint(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      if (!(await AccessPointController._canWrite(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to write access points`,
        );
        return response.sendStatus(403);
      }

      if (request.body.id) {
        return await AccessPointController._updateAccessPoint(
          request,
          response,
          tenantId,
        );
      }

      return await AccessPointController._createAccessPoint(
        request,
        response,
        tenantId,
      );
    } catch (err) {
      return next(err);
    }
  }

  static async _createAccessPoint(request, response, tenantId) {
    const user = request.user;
    const accessPoint = AccessPoint.create({
      ...AccessPointController._writableFields(request.body),
      tenantId: tenantId,
    });

    const createdAccessPoint = await AccessPointManager.storeAccessPoint(
      accessPoint,
      tenantId,
    );

    logger.info(
      `${tenantId} -- Access point ${createdAccessPoint.id} created by user ${user?.id}`,
    );
    return response.status(201).send(createdAccessPoint.toResponse());
  }

  static async _updateAccessPoint(request, response, tenantId) {
    const user = request.user;
    const accessPoint = await AccessPointManager.getAccessPoint(
      request.body.id,
      tenantId,
    );

    if (!accessPoint) {
      return response.sendStatus(404);
    }

    Object.assign(
      accessPoint,
      AccessPointController._writableFields(request.body),
    );

    const updatedAccessPoint = await AccessPointManager.storeAccessPoint(
      accessPoint,
      tenantId,
    );

    logger.info(
      `${tenantId} -- Access point ${updatedAccessPoint.id} updated by user ${user?.id}`,
    );
    return response.status(200).send(updatedAccessPoint.toResponse());
  }

  /**
   * Delete an access point and detach it from every bookable of the tenant, so
   * no bookable is left pointing at an access point that no longer exists. The
   * access log keeps its entries: they document what happened at a door that
   * once existed.
   */
  static async removeAccessPoint(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (!(await AccessPointController._canWrite(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to delete access points`,
        );
        return response.sendStatus(403);
      }

      const accessPoint = await AccessPointManager.getAccessPoint(id, tenantId);

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      await BookableManager.detachAccessPoint(tenantId, id);
      await AccessPointManager.removeAccessPoint(id, tenantId);

      logger.info(
        `${tenantId} -- Access point ${id} deleted by user ${user?.id}`,
      );
      return response.sendStatus(200);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Render the printable QR code of an access point. The code encodes the
   * store-front URL with the current scan code; a client only ever receives
   * the rendered image or PDF, never the scan code inside it. The format is
   * chosen with `?format=svg|png|pdf` and defaults to `svg`.
   */
  static async getQrCode(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const format = request.query.format || AccessQrService.QR_FORMATS.SVG;

      if (!(await AccessPointController._canWrite(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to render access point QR codes`,
        );
        return response.sendStatus(403);
      }

      if (!Object.values(AccessQrService.QR_FORMATS).includes(format)) {
        return response.status(400).send(`Unsupported format: ${format}`);
      }

      const accessPoint = await AccessPointManager.getAccessPoint(
        request.params.id,
        tenantId,
      );

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      const rendered = await AccessQrService.render(accessPoint, format);

      response.setHeader("Content-Type", rendered.contentType);
      response.setHeader(
        "Content-Disposition",
        `inline; filename="${rendered.filename}"`,
      );
      return response.status(200).send(rendered.body);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Rotate the scan code of an access point: the current code is retired and a
   * fresh one takes its place, so old stickers stop resolving at once. Rotation
   * is the revocation mechanism; a reprint is simply rotate, then fetch the QR
   * code again.
   *
   * Reserved for tenant owners. The response carries neither the old nor the
   * new scan code - both stay server knowledge.
   */
  static async rotateScanCode(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (!(await AccessPointController._canWrite(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to rotate scan codes`,
        );
        return response.sendStatus(403);
      }

      const accessPoint = await AccessPointManager.getAccessPoint(id, tenantId);

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      accessPoint.rotateScanCode();
      const rotated = await AccessPointManager.storeAccessPoint(
        accessPoint,
        tenantId,
      );

      logger.info(
        `${tenantId} -- Scan code of access point ${id} rotated by user ${user?.id}`,
      );
      return response.status(200).send(rotated.toResponse());
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Reduce a request body to the fields clients may write. Everything else -
   * above all the scan codes and the tenant - stays under server control.
   */
  static _writableFields(body) {
    return WRITABLE_FIELDS.reduce((fields, field) => {
      if (body[field] !== undefined) {
        fields[field] = body[field];
      }
      return fields;
    }, {});
  }

  static _canRead(userId, tenantId) {
    return PermissionService._allowReadAny(
      userId,
      tenantId,
      RolePermission.MANAGE_BOOKABLES,
    );
  }

  static async _canWrite(userId, tenantId) {
    return (
      (await PermissionService._isTenantOwner(userId, tenantId)) ||
      (await PermissionService._isInstanceOwner(userId))
    );
  }
}

module.exports = AccessPointController;
