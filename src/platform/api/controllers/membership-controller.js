const MembershipService = require("../../../commons/services/membership/membership-service");

const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "membership-controller.js",
  level: process.env.LOG_LEVEL,
});

class MembershipController {
  static async getMyPendingMemberships(request, response) {
    try {
      const user = request.user;

      const pendingApprovalMemberships = await MembershipService.getPendingApprovalMembershipsByUserId(user.id);

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