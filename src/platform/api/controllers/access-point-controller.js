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
const AccessService = require("../../../commons/services/access/access-service");
const LockerSystemRedistribution = require("../../../commons/services/access/locker-system-redistribution");
const LockerSystemMutex = require("../../../commons/services/access/locker-system-mutex");
const LocationGuard = require("../../../commons/services/location/location-guard");
const {
  carriesOwnCompartments,
  compartmentsOf,
  requestedCompartments,
  withScanCodes,
  assertCompartmentsUnclaimed,
} = require("../../../commons/services/access/locker-system-compartments");
const {
  getAccessProvider,
  hasAccessProvider,
} = require("../../../commons/services/access/providers/access-provider-registry");
const { ValidationError } = require("../../../errors/ValidationError");
const { BaseError, NotFoundError } = require("../../../errors/BaseError");
const createComponentLogger = require("../../../middleware/logger");

const logger = createComponentLogger("access-point-controller.js");

/**
 * How many bookings the access point's booking list names. Not a parameter of
 * the request: this is a warning the administration reads before a delete, so
 * the few it can act on plus the count of the rest is the whole answer. A
 * caller who could ask for more would be asking for a booking export.
 */
const LIVE_ACCESS_BOOKING_LIMIT = 10;

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
 * Web Controller for the access point management API. Who may read and who may
 * write is the routes' (`accessPoint.read`, `accessPoint.write`): reading is
 * open to everyone who may read bookables, writing is the tenant owner's.
 */
class AccessPointController {
  static async getAccessPoints(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

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
   * The bookings that hold a live access at this access point, for the
   * administration to see before it deletes one - what a live access is, and
   * which booking still holds it, is `AccessService.getBookingsWithLiveAccess`.
   *
   * The list names {@link LIVE_ACCESS_BOOKING_LIMIT} of them and carries the
   * whole `total` next to it.
   */
  static async getAccessPointBookings(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const id = request.params.id;

      const accessPoint = await AccessPointManager.getAccessPoint(id, tenantId);

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      const result = await AccessService.getBookingsWithLiveAccess(
        tenantId,
        id,
        { limit: LIVE_ACCESS_BOOKING_LIMIT },
      );

      return response.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * The running and future bookings at Fächer of a Schließfachanlage
   * (`?compartmentIds=<uuid>,<uuid>`), for the administration to see before
   * it takes them out of service or out of the Anlage (tickets#1043) - which
   * ones those are is `LockerSystemRedistribution.bookingsAt`. Capped like
   * the booking list, with the whole `total` next to it.
   */
  static async getCompartmentBookings(request, response, next) {
    try {
      const tenantId = request.params.tenant;

      const accessPoint = await AccessPointManager.getAccessPoint(
        request.params.id,
        tenantId,
      );

      if (!accessPoint) {
        return response.sendStatus(404);
      }

      const result = await LockerSystemRedistribution.bookingsAt(
        tenantId,
        accessPoint,
        AccessPointController._listParam(request.query.compartmentIds),
        { limit: LIVE_ACCESS_BOOKING_LIMIT },
      );

      return response.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }

  /** A query parameter given comma-separated or repeated, as a list. */
  static _listParam(value) {
    return [value]
      .flat()
      .filter((part) => typeof part === "string")
      .flatMap((part) => part.split(","))
      .map((part) => part.trim())
      .filter(Boolean);
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
      ...AccessPointController._defaultValidationRules(request.body),
      ...AccessPointController._writableFields(request.body),
      tenantId: tenantId,
    });

    accessPoint.location = LocationGuard.storable(accessPoint.location, null);
    AccessPointController._assertProviderRegistered(accessPoint);
    AccessPointController._assertRulePreconditions(accessPoint);
    AccessInfoService.validateAccessPointWithoutListing(accessPoint);
    const { entry: listedAccessPoint, asked } =
      await AccessPointController._fetchListedAccessPoint(
        accessPoint,
        tenantId,
      );
    AccessPointController._assertModeSupported(accessPoint, listedAccessPoint);
    AccessInfoService.validateAccessPoint(accessPoint, listedAccessPoint, {
      asked,
    });
    await AccessPointController._resolveOwnCompartments(accessPoint, tenantId);
    await AccessPointController._assertCompartmentsUnclaimed(
      accessPoint,
      tenantId,
    );

    const createdAccessPoint = await AccessPointManager.storeAccessPoint(
      AccessPointController._withCompartmentScanCodes(accessPoint, null),
      tenantId,
    );

    logger.info(
      `${tenantId} -- Access point ${createdAccessPoint.id} created by user ${user?.id}`,
    );
    return response.status(201).send(createdAccessPoint.toResponse());
  }

  /**
   * The rules a new access point gets when the request names none: the
   * schema's QR scan, unless its provider opens without one by default
   * (`requiresScanByDefault`) - then none. Rules the request names are
   * taken as they are.
   *
   * @param {Object} body The request body
   * @returns {{validationRules?: Object[]}} The default to spread under the
   *   writable fields, empty where the schema default applies
   */
  static _defaultValidationRules(body) {
    if (
      body.validationRules !== undefined ||
      !hasAccessProvider(body.provider)
    ) {
      return {};
    }

    return getAccessProvider(body.provider).constructor.requiresScanByDefault
      ? {}
      : { validationRules: [] };
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

    const storedLocation = accessPoint.location;
    const before = { ...accessPoint };
    Object.assign(
      accessPoint,
      AccessPointController._writableFields(request.body),
    );
    accessPoint.location = LocationGuard.storable(
      accessPoint.location,
      storedLocation,
    );

    AccessPointController._assertProviderRegistered(accessPoint);
    AccessPointController._assertRulePreconditions(accessPoint);
    AccessInfoService.validateAccessPointWithoutListing(accessPoint);
    const { entry: listedAccessPoint, asked } =
      await AccessPointController._fetchListedAccessPoint(
        accessPoint,
        tenantId,
      );
    AccessPointController._assertModeSupported(accessPoint, listedAccessPoint);
    AccessInfoService.validateAccessPoint(accessPoint, listedAccessPoint, {
      asked,
    });
    await AccessPointController._resolveOwnCompartments(accessPoint, tenantId);
    await AccessPointController._assertCompartmentsUnclaimed(
      accessPoint,
      tenantId,
    );

    const { accessPoint: updatedAccessPoint, unmoved } =
      await AccessPointController._holdingOwnCompartments(accessPoint, () =>
        LockerSystemRedistribution.storeRedistributing(
          tenantId,
          before,
          accessPoint,
          async () =>
            AccessPointManager.storeAccessPoint(
              AccessPointController._withCompartmentScanCodes(
                accessPoint,
                await AccessPointController._storedUnderHold(
                  accessPoint,
                  before,
                  tenantId,
                ),
              ),
              tenantId,
            ),
          { userId: user?.id },
        ),
      );

    logger.info(
      `${tenantId} -- Access point ${updatedAccessPoint.id} updated by user ${user?.id}`,
    );
    if (!carriesOwnCompartments(updatedAccessPoint)) {
      return response.status(200).send(updatedAccessPoint.toResponse());
    }
    // A Fach that left the Zuteilung moved the future bookings at it
    // (tickets#1043); the ones no Fach was free for stay there, and the
    // answer names them for the administration to solve by hand.
    return response
      .status(200)
      .send({ ...updatedAccessPoint.toResponse(), unmovedBookings: unmoved });
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
      const format = request.query.format || AccessQrService.QR_FORMATS.SVG;

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
   * Render the printable QR code of one Fach of a Schließfachanlage that
   * carries its own list (tickets#1056), addressed by the Anlage and the
   * Fach's UUID. Like the door's: the code inside is the Fach's own scan code,
   * a client only receives the image or PDF, `?format=svg|png|pdf` defaults to
   * `svg`. A door, an Anlage without its own list (iFBS, Pareva) and a Fach
   * the Anlage does not carry are answered 404.
   */
  static async getCompartmentQrCode(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const format = request.query.format || AccessQrService.QR_FORMATS.SVG;

      if (!Object.values(AccessQrService.QR_FORMATS).includes(format)) {
        return response.status(400).send(`Unsupported format: ${format}`);
      }

      const anlage = await AccessPointManager.getAccessPoint(
        request.params.id,
        tenantId,
      );
      const compartment = compartmentsOf(anlage).find(
        (entry) => entry.id === request.params.compartmentId,
      );

      if (!compartment) {
        return response.sendStatus(404);
      }

      const rendered = await AccessQrService.renderCompartment(
        anlage,
        compartment,
        format,
      );

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
   * Render the Sammel-PDF of a Schließfachanlage that carries its own list
   * (tickets#1062): the QR codes of all its Fächer on an Etikettenbogen, every
   * Schrank on a new page, Fächer out of service noted as such. A door and an
   * Anlage without its own list (iFBS, Pareva) are answered 404.
   */
  static async getCompartmentQrSheet(request, response, next) {
    try {
      const anlage = await AccessPointManager.getAccessPoint(
        request.params.id,
        request.params.tenant,
      );

      if (!carriesOwnCompartments(anlage)) {
        return response.sendStatus(404);
      }

      const rendered = await AccessQrService.renderCompartmentSheet(anlage);

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
   * The response carries neither the old nor the new scan code - both stay
   * server knowledge.
   */
  static async rotateScanCode(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;

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
   * Rotate the scan code of one Fach of a Schließfachanlage that carries its
   * own list (tickets#1061), addressed by the Anlage and the Fach's UUID, by
   * the door's rule. It runs under the mutex of the Anlage, which every save
   * of the Anlage holds too, and reads the Anlage again inside it: a save
   * never writes the old code back, and the rotation never writes back what
   * a save changed. A door, an Anlage without its own list (iFBS, Pareva)
   * and a Fach the Anlage does not carry are answered 404.
   *
   * The response carries neither the old nor the new scan code.
   */
  static async rotateCompartmentScanCode(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const { id, compartmentId } = request.params;

      const anlage = await AccessPointManager.getAccessPoint(id, tenantId);
      if (!carriesOwnCompartments(anlage)) {
        return response.sendStatus(404);
      }

      const rotated = await LockerSystemMutex.hold(anlage, async () => {
        const current = await AccessPointManager.getAccessPoint(id, tenantId);
        if (
          !carriesOwnCompartments(current) ||
          !current.rotateCompartmentScanCode(compartmentId)
        ) {
          return null;
        }
        return AccessPointManager.storeAccessPoint(current, tenantId);
      });

      if (!rotated) {
        return response.sendStatus(404);
      }
      logger.info(
        `${tenantId} -- Scan code of Fach ${compartmentId} of access point ${id} rotated by user ${request.user?.id}`,
      );
      return response.status(200).send(rotated.toResponse());
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Rotate the scan codes of all Fächer of a Schließfachanlage that carries
   * its own list (tickets#1063), after an incident that voids every sticker:
   * each Fach by the rule of one Fach, the Anlage stored once. Like the
   * rotation of one Fach it runs under the mutex of the Anlage and reads the
   * Anlage again inside it. A door and an Anlage without its own list (iFBS,
   * Pareva) are answered 404.
   *
   * The response carries neither the old nor the new scan codes.
   */
  static async rotateAllCompartmentScanCodes(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const { id } = request.params;

      const anlage = await AccessPointManager.getAccessPoint(id, tenantId);
      if (!carriesOwnCompartments(anlage)) {
        return response.sendStatus(404);
      }

      const rotated = await LockerSystemMutex.hold(anlage, async () => {
        const current = await AccessPointManager.getAccessPoint(id, tenantId);
        if (
          !carriesOwnCompartments(current) ||
          !current.rotateAllCompartmentScanCodes()
        ) {
          return null;
        }
        return AccessPointManager.storeAccessPoint(current, tenantId);
      });

      if (!rotated) {
        return response.sendStatus(404);
      }
      logger.info(
        `${tenantId} -- Scan codes of all ${compartmentsOf(rotated).length} Fächer of access point ${id} rotated by user ${request.user?.id}`,
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
   * Providers without the optional `getLocation` capability - and providers
   * that simply know no position - answer `null`.
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
   * Refuse a provider the registry does not know - a typo such as `dummy`,
   * which would otherwise be stored and only fail at the door. Checked against
   * the state the write would leave behind, so an existing access point with
   * such a provider is refused as soon as it is saved again.
   *
   * The registry decides, not the tenant's applications: a provider the
   * tenant has not switched on yet still takes an access point, so one can be
   * prepared before the application is.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @throws {ValidationError} `unknown_provider` naming the provider
   */
  static _assertProviderRegistered(accessPoint) {
    if (hasAccessProvider(accessPoint.provider)) {
      return;
    }

    throw new ValidationError([
      {
        field: "provider",
        code: "unknown_provider",
        params: { provider: accessPoint.provider },
      },
    ]);
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
   * The provider's listed entry for the access point as the write would
   * leave it - fetched once per save and handed to every check that reads
   * it, so a save costs one provider round trip. A provider that cannot be
   * asked is answered as such instead of a 500: an HTTP 401 or 403 from the
   * provider means its token was rejected (`502 access_provider_rejected`),
   * everything else - network, timeout, 5xx - that it cannot be reached
   * (`503 access_provider_unreachable`). Both name the provider; neither
   * stores anything. The status codes are the only provider-neutral
   * distinction there is, so this holds for every provider alike.
   *
   * A `NotFoundError` counts as "the provider does not list it": every
   * provider raises one (`<provider>_application_not_found`) when the tenant
   * has no active application for it, and that says nothing about the lock.
   * The access point is stored, and the checks that need the listing let
   * through what they cannot judge without it - so an access point can be
   * prepared before its provider is switched on (tickets#311), and is
   * checked on the first save once the provider is active. `asked` says
   * whether the listing was asked at all - not for a provider that is not
   * active, nor for an access point without `externalId` - so a provider
   * that lists only what the tenant's account may open (Open Locker) can
   * tell "not listed" from "not asked". Anything else the provider raises
   * is translated.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<{entry: Object|null, asked: boolean}>} The listed
   *   entry, `null` when the provider does not list the access point or the
   *   listing was not asked; `asked` is `false` for the latter
   * @throws {BaseError} `access_provider_rejected` (502) or
   *   `access_provider_unreachable` (503)
   */
  static async _fetchListedAccessPoint(accessPoint, tenantId) {
    if (!AccessInfoService.asksListing(accessPoint)) {
      return { entry: null, asked: false };
    }

    try {
      return {
        entry: await AccessInfoService.findListedAccessPoint(
          accessPoint,
          tenantId,
        ),
        asked: true,
      };
    } catch (err) {
      AccessPointController._answerListingFailure(err, accessPoint, tenantId);
      return { entry: null, asked: false };
    }
  }

  /**
   * What a failed listing means for the save: returns for a provider the
   * tenant has not switched on (`NotFoundError`), so the save goes on
   * unchecked, and throws the provider failure otherwise - see
   * `_fetchListedAccessPoint`.
   *
   * @param {Error} err What the listing threw
   * @param {AccessPoint} accessPoint The access point being saved
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {void} When the provider is not active
   * @throws {BaseError} `access_provider_rejected` (502) or
   *   `access_provider_unreachable` (503)
   */
  static _answerListingFailure(err, accessPoint, tenantId) {
    if (err instanceof NotFoundError) {
      logger.info(
        `${tenantId} -- Provider ${accessPoint.provider} is not active, access point stored without its listing: ${err.code}`,
      );
      return;
    }

    const status = err?.response?.status;
    const params = { provider: accessPoint.provider };

    logger.warn(
      `${tenantId} -- Provider ${accessPoint.provider} did not list its access points: ${err?.message || err}`,
    );

    if (status === 401 || status === 403) {
      throw new BaseError("access_provider_rejected", 502, params);
    }

    throw new BaseError("access_provider_unreachable", 503, params);
  }

  /**
   * The Fächer of a Schließfachanlage that carries its own list, written
   * back into its `config` as they are stored (tickets#1037): Schrank and
   * number from the provider's listing, so a rename at the provider takes
   * effect on the next save. A provider the tenant has not switched on is
   * not asked, and the Fächer are stored as the request names them, like a
   * fixed Fach (tickets#311, #971). A provider whose Anlagen carry no list
   * of their own refuses one.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<void>}
   * @throws {ValidationError} The list's shape, a provider without such
   *   lists, or a Fach the provider does not list
   * @throws {BaseError} When the provider cannot be asked
   */
  static async _resolveOwnCompartments(accessPoint, tenantId) {
    if (!carriesOwnCompartments(accessPoint)) {
      return;
    }

    if (!AccessInfoService.resolvesCompartments(accessPoint.provider)) {
      throw new ValidationError([
        {
          field: "config.compartments",
          code: "unsupported_by_provider",
          params: { provider: accessPoint.provider },
        },
      ]);
    }

    let compartments = requestedCompartments(accessPoint.config.compartments);

    try {
      const listing = await AccessInfoService.getAccessPoints(
        tenantId,
        accessPoint.provider,
      );
      compartments = AccessInfoService.resolveCompartments(
        accessPoint,
        compartments,
        listing,
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        throw err;
      }
      AccessPointController._answerListingFailure(err, accessPoint, tenantId);
    }

    accessPoint.config = { ...accessPoint.config, compartments };
  }

  /**
   * Runs the store of an Anlage that carries its own list under the mutex
   * of the Anlage (tickets#1055): a rotation of the codes of its Fächer
   * runs under the same mutex, so a save never writes back a code rotated
   * while it was under way. Every other access point is stored straight
   * away. The mutex is re-entrant, so a store that moves bookings holds it
   * once.
   *
   * @template T
   * @param {AccessPoint} accessPoint The access point as it will be stored
   * @param {() => Promise<T>} store Stores it
   * @returns {Promise<T>} What the store answers
   */
  static async _holdingOwnCompartments(accessPoint, store) {
    return carriesOwnCompartments(accessPoint)
      ? LockerSystemMutex.hold(accessPoint, store)
      : store();
  }

  /**
   * The access point as stored right now, read again under the mutex of an
   * Anlage that carries its own list, so its Fächer keep the codes they
   * carry at this moment (see `_holdingOwnCompartments`). Every other
   * access point, and one gone in between, answers what the save read
   * first.
   *
   * @param {AccessPoint} accessPoint The access point as it will be stored
   * @param {Object} before The access point as the save read it first
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<Object>} The access point as stored
   */
  static async _storedUnderHold(accessPoint, before, tenantId) {
    if (!carriesOwnCompartments(accessPoint)) {
      return before;
    }
    return (
      (await AccessPointManager.getAccessPoint(accessPoint.id, tenantId)) ??
      before
    );
  }

  /**
   * The Anlage with a scan code on each of its Fächer (tickets#1055), see
   * `withScanCodes`: kept from the stored Anlage, fresh for a Fach new to
   * it. Only an Anlage that carries its own list has codes per Fach; every
   * other access point is left as it is.
   *
   * @param {AccessPoint} accessPoint The access point as it will be stored,
   *   written into
   * @param {Object|null} stored The access point as stored before the
   *   save, `null` on a create
   * @returns {AccessPoint} The access point
   */
  static _withCompartmentScanCodes(accessPoint, stored) {
    if (carriesOwnCompartments(accessPoint)) {
      accessPoint.config = {
        ...accessPoint.config,
        compartments: withScanCodes(
          accessPoint.config.compartments,
          compartmentsOf(stored),
        ),
      };
    }
    return accessPoint;
  }

  /**
   * Refuses a Fach another access point of the tenant already holds - see
   * `assertCompartmentsUnclaimed`. Asked only where it can matter: for an
   * Anlage that carries its own list, and for a fixed Fach of a provider
   * whose Anlagen do.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<void>}
   * @throws {ValidationError} At the Fach another access point holds
   */
  static async _assertCompartmentsUnclaimed(accessPoint, tenantId) {
    if (
      !carriesOwnCompartments(accessPoint) &&
      !(
        accessPoint.externalId &&
        AccessInfoService.resolvesCompartments(accessPoint.provider)
      )
    ) {
      return;
    }

    assertCompartmentsUnclaimed(
      accessPoint,
      await AccessPointManager.getAccessPoints(tenantId),
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
   * An empty `supportedModes` says the lock can do nothing right now - a
   * Salto lock whose IQ is not activated, or needs re-activation - not that
   * it can never do the mode, and lets it through as well (tickets#570). The
   * access point opens once the lock can; until then the open fails on its
   * own. Only a mode the lock reports it cannot do is refused here; a mode a
   * provider rules out for every lock is its
   * `validateAccessPointWithoutListing`'s to refuse, before the listing.
   *
   * @param {AccessPoint} accessPoint The access point as it would be stored
   * @param {Object|null} listedAccessPoint The provider's listed entry for
   *   it (see `_fetchListedAccessPoint`), `null` when the provider does not
   *   list it
   * @throws {ValidationError} If the lock does not support the mode
   */
  static _assertModeSupported(accessPoint, listedAccessPoint) {
    const supportedModes =
      AccessInfoService.supportedModesOf(listedAccessPoint);

    if (
      !supportedModes ||
      supportedModes.length === 0 ||
      supportedModes.includes(accessPoint.mode)
    ) {
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
}

module.exports = AccessPointController;
