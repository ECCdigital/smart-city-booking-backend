const bunyan = require("bunyan");
const AccessInfoService = require("../../../commons/services/access/access-info-service");
const SaltoKsIqActivationService = require("../../../commons/services/access/salto-ks-iq-activation-service");
const {
  hasTestHandler,
} = require("../../../commons/services/access/clients/access-test-registry");
const { BaseError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "access-app-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The access apps of a tenant: what a provider knows and what it is
 * configured with. Who may read and who may configure is the routes'
 * (`accessApp.read`, `accessApp.manage`) - the latter the tenant owner's,
 * where the dead role group `manageTenants` used to stand (spec §7.3).
 */
class AccessAppController {
  static async getProviders(request, response) {
    try {
      const { tenant } = request.params;
      const providers = await AccessInfoService.getActiveProviders(tenant);
      return response.status(200).send(providers);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get access providers");
    }
  }

  static async getAccessPoints(request, response) {
    try {
      const { tenant, provider } = request.params;
      const points = await AccessInfoService.getAccessPoints(tenant, provider);
      return response.status(200).send(points);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get access points");
    }
  }

  static async testConnection(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

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
        `${tenant} -- ${provider} access connection test by user ${user?.id}: ${result.success}`,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not test access connection");
    }
  }

  static async registerWebhook(request, response) {
    try {
      const { tenant, provider } = request.params;
      const { callbackUrl } = request.body;
      if (!callbackUrl) {
        return response.status(400).send("Missing callbackUrl");
      }

      const result = await AccessInfoService.registerWebhook(
        tenant,
        provider,
        callbackUrl,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not register access webhook");
    }
  }

  static async unregisterWebhook(request, response) {
    try {
      const { tenant, provider } = request.params;
      const { notificationId } = request.body;
      const result = await AccessInfoService.unregisterWebhook(
        tenant,
        provider,
        notificationId,
      );
      return response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not unregister access webhook");
    }
  }

  /**
   * GET /:tenant/access-apps/salto-ks/iqs
   *
   * The IQs of the tenant's Salto site with their live flags and the local
   * activation state - what the IQ activation wizard renders. Never carries
   * secrets or PINs.
   */
  static async saltoKsListIqs(request, response) {
    return AccessAppController._renderSaltoKsWizardStep(
      request,
      response,
      ({ tenant }) => SaltoKsIqActivationService.listIqs(tenant),
      "Could not list Salto KS IQs",
    );
  }

  /**
   * POST /:tenant/access-apps/salto-ks/iqs/:iqId/activation/start
   */
  static async saltoKsStartIqActivation(request, response) {
    return AccessAppController._renderSaltoKsWizardStep(
      request,
      response,
      ({ tenant, iqId }) =>
        SaltoKsIqActivationService.startActivation(tenant, iqId),
      "Could not start Salto KS IQ activation",
    );
  }

  /**
   * POST /:tenant/access-apps/salto-ks/iqs/:iqId/activation/complete
   *
   * The admin enters the PIN Salto mailed to the system user's mailbox - the
   * one manual capture of the wizard.
   */
  static async saltoKsCompleteIqActivation(request, response) {
    return AccessAppController._renderSaltoKsWizardStep(
      request,
      response,
      ({ tenant, iqId }) =>
        SaltoKsIqActivationService.completeActivation(
          tenant,
          iqId,
          request.body?.pin,
        ),
      "Could not complete Salto KS IQ activation",
    );
  }

  /**
   * DELETE /:tenant/access-apps/salto-ks/iqs/:iqId/activation
   *
   * Discards the local activation entry; calls nothing at Salto. The basis of
   * a re-activation.
   */
  static async saltoKsDiscardIqActivation(request, response) {
    return AccessAppController._renderSaltoKsWizardStep(
      request,
      response,
      ({ tenant, iqId }) =>
        SaltoKsIqActivationService.discardActivation(tenant, iqId),
      "Could not discard Salto KS IQ activation",
    );
  }

  /**
   * @private
   * One wizard step: guarded like the connection test (`accessApp.manage`), a
   * refused step answers with its error code so the wizard can say what
   * happened - e.g. that the system user is already activated at the IQ.
   */
  static async _renderSaltoKsWizardStep(request, response, step, errorMessage) {
    try {
      const { tenant, iqId } = request.params;
      const result = await step({ tenant, iqId });
      return response.status(200).send(result);
    } catch (err) {
      if (err instanceof BaseError) {
        return response.status(err.statusCode).send(err.toJSON());
      }

      logger.error(err);
      return response.status(500).send(errorMessage);
    }
  }
}

module.exports = AccessAppController;
