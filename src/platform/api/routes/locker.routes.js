/**
 * The `/locker/:provider/...` routes of the admin UI, kept one release as
 * a facade after the locker fold: locker systems are access points now,
 * so the locations and sizes are what `AccessInfoService` lists for the
 * provider, the price is the checkout price provider's, and the connection
 * test is the access test registry's. The admin UI follow-up moves to the
 * access point area (`/access-apps`, `/accesspoints`); then these go.
 */

const express = require("express");
const bunyan = require("bunyan");
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessInfoService = require("../../../commons/services/access/access-info-service");
const ExternalPriceService = require("../../../commons/services/external-price-service");
const PermissionService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const {
  hasTestHandler,
} = require("../../../commons/services/access/clients/access-test-registry");

const router = express.Router({ mergeParams: true });

const logger = bunyan.createLogger({
  name: "locker.routes.js",
  level: process.env.LOG_LEVEL,
});

function canRead(userId, tenant) {
  return PermissionService._allowReadAny(
    userId,
    tenant,
    RolePermission.MANAGE_BOOKABLES,
  );
}

function fail(response, err, message) {
  logger.error(err);
  return response
    .status(err.statusCode || 500)
    .send(err.statusCode ? err.message : message);
}

/** The listed access point a location id names, by its id or external id. */
async function findLocation(tenant, provider, locationId) {
  const accessPoints = await AccessInfoService.getAccessPoints(
    tenant,
    provider,
  );
  const wanted = String(locationId);

  return (
    (accessPoints || []).find(
      (candidate) =>
        String(candidate.id) === wanted ||
        String(candidate.externalId) === wanted,
    ) || null
  );
}

async function answerLocation(request, response, message) {
  try {
    const { tenant, provider, locationId } = request.params;

    if (!locationId) {
      return response.status(400).send("Missing locationId");
    }

    if (!(await canRead(request.user.id, tenant))) {
      return response.sendStatus(403);
    }

    const location = await findLocation(tenant, provider, locationId);

    if (!location) {
      return response.status(404).send("Location not found");
    }

    return response.status(200).send(location);
  } catch (err) {
    return fail(response, err, message);
  }
}

const lockerFacade = {
  /** GET /:tenant/locker/:provider/locations */
  async listLocations(request, response) {
    try {
      const { tenant, provider } = request.params;

      if (!(await canRead(request.user.id, tenant))) {
        return response.sendStatus(403);
      }

      const locations = await AccessInfoService.getAccessPoints(
        tenant,
        provider,
      );

      return response.status(200).send(locations);
    } catch (err) {
      return fail(response, err, "Could not get locker locations");
    }
  },

  /** GET /:tenant/locker/:provider/locations/:locationId */
  getLocation(request, response) {
    return answerLocation(request, response, "Could not get locker location");
  },

  /**
   * GET /:tenant/locker/:provider/locations/:locationId/status - what the
   * provider lists for the location; the raw record is its `metadata`.
   */
  getLocationStatus(request, response) {
    return answerLocation(
      request,
      response,
      "Could not get locker location status",
    );
  },

  /** GET /:tenant/locker/:provider/locations/:locationId/price */
  async getLocationPrice(request, response) {
    try {
      const { tenant, provider, locationId } = request.params;

      if (!locationId) {
        return response.status(400).send("Missing locationId");
      }

      if (!(await canRead(request.user.id, tenant))) {
        return response.sendStatus(403);
      }

      const categories = await ExternalPriceService.categoriesOf(
        tenant,
        provider,
        { locationId: String(locationId) },
      );

      if (categories === null) {
        return response
          .status(400)
          .send(`No price available for provider: ${provider}`);
      }

      return response.status(200).send(categories);
    } catch (err) {
      return fail(response, err, "Could not get locker pricing");
    }
  },

  /** POST /:tenant/locker/:provider/test */
  async testConnection(request, response) {
    try {
      const { tenant, provider } = request.params;

      if (!(await canRead(request.user.id, tenant))) {
        return response.sendStatus(403);
      }

      if (!hasTestHandler(provider)) {
        return response
          .status(400)
          .send(`No test available for provider: ${provider}`);
      }

      const result = await AccessInfoService.testConnection(
        provider,
        request.body,
        { tenantId: tenant },
      );

      logger.info(
        `${tenant} -- ${provider} connection test by user ${request.user?.id}: ${result.success}`,
      );

      return response.status(200).send(result);
    } catch (err) {
      return fail(response, err, "Could not test locker connection");
    }
  },
};

router.get(
  "/:provider/locations",
  AuthenticationController.isSignedIn,
  lockerFacade.listLocations,
);

router.get(
  "/:provider/locations/:locationId",
  AuthenticationController.isSignedIn,
  lockerFacade.getLocation,
);

router.get(
  "/:provider/locations/:locationId/status",
  AuthenticationController.isSignedIn,
  lockerFacade.getLocationStatus,
);

router.get(
  "/:provider/locations/:locationId/price",
  AuthenticationController.isSignedIn,
  lockerFacade.getLocationPrice,
);

router.post(
  "/:provider/test",
  AuthenticationController.isSignedIn,
  lockerFacade.testConnection,
);

module.exports = router;
module.exports.lockerFacade = lockerFacade;
