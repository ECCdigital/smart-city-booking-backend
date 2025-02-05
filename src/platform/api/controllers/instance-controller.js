const InstanceManger = require("../../../commons/data-managers/instance-manager");

class InstanceController {
  static async getInstance(request, response) {
    try {
      const instance = await InstanceManger.getInstance(false);
      response.status(200).send(instance);
    } catch (error) {
      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }
  static async getPublicInstance(request, response) {
    try {
      const instance = await InstanceManger.getInstance(true);
      response.status(200).send(instance);
    } catch (error) {
      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }

  static async storeInstance(request, response) {
    try {
      const updatedInstance = await InstanceManger.updateInstance(request.body);
      response.status(200).send(updatedInstance);
    } catch (error) {
      console.log("Error:", error);
      response.status(500).send({ message: error.message });
    }
  }
}

module.exports = InstanceController;
