const InstanceManger = require("../../../commons/data-managers/instance-manager");
const MediaReferenceGuard = require("../../../commons/services/media/media-reference-guard");
const PermissionService = require("../../../commons/services/permission-service");
const { BaseError } = require("../../../errors/BaseError");

class InstanceController {
  static async getInstance(request, response) {
    const user = request.user;
    try {
      const instance = await InstanceManger.getInstance();

      const hasPermission = await PermissionService._isInstanceOwner(user.id);
      if (!hasPermission) {
        return response.status(403).send({ message: "Permission denied" });
      }
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
      const { user, body } = request;
      const hasPermission = await PermissionService._isInstanceOwner(user.id);

      if (!hasPermission) {
        return response.status(403).send({ message: "Permission denied" });
      }

      await MediaReferenceGuard.assertInstanceStorable(body, user.id);

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

  static async getBookableCustomFields(request, response) {
    const bookableCustomFields = await InstanceManger.getBookableCustomFields();

    response.status(200).send(bookableCustomFields);
  }
}

module.exports = InstanceController;
