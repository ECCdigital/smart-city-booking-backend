const bunyan = require("bunyan");
const GuardianConsentService = require("../../../commons/services/student/guardian-consent-service");
const { sendError } = require("../../../commons/utilities/http-error");

const logger = bunyan.createLogger({
  name: "guardian-consent-controller.js",
  level: process.env.LOG_LEVEL,
});

class GuardianConsentController {
  static async getMyStatus(request, response) {
    try {
      const status = await GuardianConsentService.getStatus(request.user.id);
      return response.status(200).send(status);
    } catch (error) {
      logger.error("Could not load guardian consent status", error);
      return sendError(response, error, "Could not load guardian consent");
    }
  }

  static async resend(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await GuardianConsentService.resend(
        tenantId,
        request.user.id,
        request.body && request.body.guardianEmail,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not resend guardian consent request", error);
      return sendError(response, error, "Could not resend consent request");
    }
  }

  static async adminGrant(request, response) {
    return GuardianConsentController._adminSet(request, response, true);
  }

  static async adminRevoke(request, response) {
    return GuardianConsentController._adminSet(request, response, false);
  }

  static async _adminSet(request, response, granted) {
    try {
      const status = await GuardianConsentService.adminSetConsent(
        request.params.tenant,
        request.params.userId,
        request.user.id,
        granted,
      );
      return response.status(200).send(status);
    } catch (error) {
      logger.error("Could not change guardian consent", error);
      return sendError(response, error, "Could not change guardian consent");
    }
  }

  static async lookup(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await GuardianConsentService.lookup(
        tenantId,
        request.body && request.body.token,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.warn("Guardian consent lookup failed", error);
      return sendError(response, error, "Could not read consent request");
    }
  }

  static async confirm(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await GuardianConsentService.confirm(
        tenantId,
        request.body && request.body.token,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.warn("Guardian consent confirmation failed", error);
      return sendError(response, error, "Could not confirm consent");
    }
  }
}

module.exports = GuardianConsentController;
