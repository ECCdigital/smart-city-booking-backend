const AccessPointManager = require("../../../commons/data-managers/access-point-manager");
const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const {
  AccessPoint,
} = require("../../../commons/entities/access/access-point");
const AccessQrService = require("../../../commons/services/access/access-qr-service");
const AccessLocationService = require("../../../commons/services/access/access-location-service");
const AccessEvidenceService = require("../../../commons/services/access/access-evidence-service");
const AccessInfoService = require("../../../commons/services/access/access-info-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionService = require("../../../commons/services/permission-service");
const { ValidationError } = require("../../../errors/ValidationError");
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

    AccessPointController._assertRulePreconditions(accessPoint);
    await AccessPointController._assertModeSupported(accessPoint, tenantId);

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

    AccessPointController._assertRulePreconditions(accessPoint);
    await AccessPointController._assertModeSupported(accessPoint, tenantId);

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
   * Suggest the location of an access point from what its provider knows about
   * the physical lock, so an admin does not have to type coordinates twice.
   *
   * Read-only: the suggestion is sent as it comes from the provider and nothing
   * is written to the access point. Adopting it is an explicit PUT, which keeps
   * the entity the only source of the location.
   *
   * Reserved for tenant owners. Providers without the optional `getLocation`
   * capability - and providers that simply know no position - answer `null`.
   *
   * @param {Object} request Express request, `params.tenant` and `params.id`
   * @param {Object} response Express response, receives the location or `null`
   * @param {Function} next Express error handler
   * @returns {Promise<void>} Resolves once the response has been sent
   */
  static async getLocationPrefill(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

      if (!(await AccessPointController._canWrite(user.id, tenantId))) {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to read access point location prefills`,
        );
        return response.sendStatus(403);
      }

      const accessPoint = await AccessPointManager.getAccessPoint(id, tenantId);

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      const location = await AccessLocationService.getLocationPrefill(
        accessPoint,
        tenantId,
      );

      logger.info(
        `${tenantId} -- Location prefill of access point ${id} requested by user ${user?.id}`,
      );
      return response.status(200).json(location);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Refuse validation rules the access point cannot carry, e.g. a geo rule on a
   * door without a location. Checked against the state the write would leave
   * behind, so a rule and the field it needs can be submitted together.
   *
   * This is the first of the two places the preconditions are enforced: the
   * second is the open path, which fails closed if the state drifts away from
   * them later. A rule is never silently skipped.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @throws {ValidationError} If a configured rule lacks a precondition
   */
  static _assertRulePreconditions(accessPoint) {
    const unmet = AccessEvidenceService.findUnmetPreconditions(accessPoint);

    if (unmet.length === 0) {
      return;
    }

    throw new ValidationError(
      unmet.map(({ ruleType, requires }) => ({
        field: "validationRules",
        code: "precondition_failed",
        params: { ruleType: ruleType, requires: requires },
      })),
    );
  }

  /**
   * Refuse a `mode` the hardware cannot do, e.g. `remote` on an access point
   * that only knows authorizations. This is where the mode is written, so this
   * is where an administrator is told - rather than at the door, where the same
   * mismatch only surfaces as a booking that cannot be provisioned.
   *
   * Checked against the state the write would leave behind, so pointing an
   * access point at other hardware is judged by the new one. A provider that
   * reports no `supportedModes` is taken at its word and lets the mode
   * through: an unknown capability is not a missing one.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @param {string} tenantId Tenant the access point belongs to
   * @throws {ValidationError} If the lock does not support the mode
   */
  static async _assertModeSupported(accessPoint, tenantId) {
    const supportedModes = await AccessInfoService.getSupportedModes(
      accessPoint,
      tenantId,
    );

    if (!supportedModes || supportedModes.includes(accessPoint.mode)) {
      return;
    }

    throw new ValidationError([
      {
        field: "mode",
        code: "unsupported_mode",
        params: { mode: accessPoint.mode, supportedModes: supportedModes },
      },
    ]);
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
