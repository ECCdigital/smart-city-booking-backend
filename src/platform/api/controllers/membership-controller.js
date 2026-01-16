const MembershipService = require("../../../commons/services/membership/membership-service");
const MembershipManager = require("../../../commons/data-managers/membership-manager");

const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");

const logger = bunyan.createLogger({
  name: "membership-controller.js",
  level: process.env.LOG_LEVEL,
});

class MembershipController {
  static async getMemberships(request, response) {
    try {
      const user = request.user;


      const hasPermission = await PermissionService._isInstanceOwner(user);

      if (!hasPermission) {
        return response.sendStatus(403);
      }


      const memberships = await MembershipManager.getMemberships();


      response.status(200).send(memberships);
    } catch (error) {
      logger.error(error);
      return response
        .status(error.code || 500)
        .send(error.message || "Could not retrieve memberships");
    }
  }

  static async getMyPendingMemberships(request, response) {
    try {
      const user = request.user;

      const pendingApprovalMemberships =
        await MembershipService.getPendingApprovalMembershipsByUserId(user.id);

      response.status(200).send(pendingApprovalMemberships);
    } catch (error) {
      logger.error(error);
      return response
        .status(error.code || 500)
        .send(error.message || "Could not retrieve pending memberships");
    }
  }
}

module.exports = MembershipController;
