const InstanceManger = require("../../../commons/data-managers/instance-manager");
const MediaReferenceGuard = require("../../../commons/services/media/media-reference-guard");
const { reachesOf } = require("../../../commons/services/authorization");
const KeycloakCheckService = require("../../../commons/services/keycloak-check/keycloak-check-service");
const JwtHelper = require("../../../commons/utilities/jwt-helper");
const { BaseError } = require("../../../errors/BaseError");

/**
 * Web Controller for the instance. The right is the router's
 * (`instance.read`, `instance.update`: the instance owner).
 */
class InstanceController {
  static async getInstance(request, response) {
    try {
      const instance = await InstanceManger.getInstance();
      response.status(200).send(instance?.exportWithMedia() ?? instance);
    } catch (error) {
      response.status(500).send({ message: error.message });
    }
  }

  static async getPublicInstance(request, response) {
    try {
      const instance = await InstanceManger.getInstance();
      instance.removePrivateData();
      response.status(200).send(instance.exportWithMedia());
    } catch (error) {
      response.status(500).send({ message: error.message });
    }
  }

  static async storeInstance(request, response) {
    try {
      const { body } = request;

      await MediaReferenceGuard.assertInstanceStorable(
        body,
        reachesOf(request),
      );

      const updatedInstance = await InstanceManger.updateInstance(body);
      response
        .status(200)
        .send(updatedInstance?.exportWithMedia() ?? updatedInstance);
    } catch (error) {
      // A rejected media reference has to reach the admin UI with its code —
      // the blanket 500 below would hide why the save was refused.
      if (error instanceof BaseError) {
        return response.status(error.statusCode).send(error.toJSON());
      }

      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }

  /**
   * „Realm prüfen“: checks the stored Keycloak realm from outside and
   * answers one row per requirement (`instance.checkRealm`, the instance
   * owner). Nothing is stored. A refused body or missing stored values reach
   * the error handler as `400`.
   *
   * @param {import("express").Request} request Body `{ mode, apps }`
   * @param {import("express").Response} response `{ checkedAt, rows }`
   */
  static async checkKeycloakRealm(request, response) {
    const result = await KeycloakCheckService.check(request.body, {
      authType: request.user?.authType ?? null,
      accessToken: JwtHelper.extractToken(request.headers.authorization),
    });
    response.status(200).send(result);
  }

  static async getBookableCustomFields(request, response) {
    const bookableCustomFields = await InstanceManger.getBookableCustomFields();

    response.status(200).send(bookableCustomFields);
  }
}

module.exports = InstanceController;
