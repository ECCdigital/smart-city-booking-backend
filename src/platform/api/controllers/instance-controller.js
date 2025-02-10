const InstanceManger = require("../../../commons/data-managers/instance-manager");

class InstancePermissions {
  static _isOwner(affectedInstance, userId) {
    return affectedInstance.ownerUserIds.includes(userId);
  }

  static async _allowCreate(affectedInstance, userId) {
    return false;
  }

  static async _allowRead(affectedInstance, userId) {
    return InstancePermissions._isOwner(affectedInstance, userId);
  }

  static async _allowUpdate(affectedInstance, userId) {
    return InstancePermissions._isOwner(affectedInstance, userId);
  }

  static async _allowDelete(affectedInstance, userId) {
    return InstancePermissions._isOwner(affectedInstance, userId);
  }
}

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

      const hasPermission = await InstancePermissions._allowRead(instance, user.id);
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
      const hasPermission = await InstancePermissions._allowUpdate(instance, user.id);

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
