const InstanceManger = require("../../../commons/data-managers/instance-manager");
const PermissionService = require("../../../commons/services/permission-service");

class InstanceController {
  static async getInstance(request, response) {
    const publicInstance = request.query.publicInstance === "true";
    const user = request.user;
    try {
      const instance = await InstanceManger.getInstance();

      if (publicInstance) {
        instance.removePrivateData();
        return response.status(200).send(instance);
      }

      const hasPermission = await PermissionService._isInstanceOwner(user.id);
      if (!hasPermission) {
        return response.status(403).send({ message: "Permission denied" });
      }

      response.status(200).send(instance);
    } catch (error) {
      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }

  static async storeInstance(request, response) {
    try {
      const { user, body } = request;
      const instance = await InstanceManger.getInstance();
      const hasPermission = await PermissionService._isInstanceOwner(user.id);

      if (!hasPermission) {
        return response.status(403).send({ message: "Permission denied" });
      }

      const updatedInstance = await InstanceManger.updateInstance(body);
      response.status(200).send(updatedInstance);
    } catch (error) {
      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }
}

module.exports = InstanceController;
