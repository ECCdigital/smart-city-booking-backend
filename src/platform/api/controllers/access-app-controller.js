const bunyan = require("bunyan");
const AccessInfoService = require("../../../commons/services/access/access-info-service");
const AccessAppLifecycleService = require("../../../commons/services/access/access-app-lifecycle-service");
const { scopeOf } = require("../../../commons/services/authorization");
const SaltoKsIqActivationService = require("../../../commons/services/access/salto-ks-iq-activation-service");
const {
  hasTestHandler,
} = require("../../../commons/services/access/clients/access-test-registry");
const { BaseError, NotFoundError } = require("../../../errors/BaseError");
const ApiResponse = require("../../../commons/utilities/api-response");

const logger = bunyan.createLogger({
  name: "access-app-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The access apps of a tenant: what a provider knows and what it is
 * configured with. Who may read and who may configure is the routes'
 * (`accessApp.read`, `accessApp.manage`) - the latter the tenant owner's,
 * where the dead role group `manageTenants` used to stand.
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

  /**
   * The locks the provider lists for the tenant. A tenant without an active
   * application for the provider is answered `404
   * <provider>_application_not_found` (tickets#311), so the admin UI can say
   * that lock and mode are checked once the provider is active; every other
   * failure stays a 500.
   */
  static async getAccessPoints(request, response) {
    try {
      const { tenant, provider } = request.params;
      const points = await AccessInfoService.getAccessPoints(tenant, provider);
      return response.status(200).send(points);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ApiResponse.fail(response, err);
      }

      logger.error(err);
      return response.status(500).send("Could not get access points");
    }
  }

  /**
   * PUT /:tenant/access-apps/:provider
   *
   * Saves the provider's access application on its own: creates it switched
   * on or changes it, keeps a secret the form leaves empty, and answers it
   * without secrets (`storedSecrets` says which are stored).
   */
  static async saveApplication(request, response, next) {
    try {
      const { tenant, provider } = request.params;
      const app = await AccessAppLifecycleService.saveApplication(
        tenant,
        provider,
        request.body || {},
        scopeOf(request),
      );
      logger.info(
        `${tenant} -- ${provider} access application saved by user ${request.user?.id}`,
      );
      return response.status(200).send(app);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /:tenant/access-apps/:provider/active
   *
   * Switches the provider's access application on or off (`{ active }`),
   * nothing else; answers it without secrets.
   */
  static async setApplicationActive(request, response, next) {
    try {
      const { tenant, provider } = request.params;
      const app = await AccessAppLifecycleService.setActive(
        tenant,
        provider,
        request.body?.active,
        scopeOf(request),
      );
      logger.info(
        `${tenant} -- ${provider} access application switched ${app.active ? "on" : "off"} by user ${request.user?.id}`,
      );
      return response.status(200).send(app);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /:tenant/access-apps/:provider
   *
   * Removes the provider's access application with its credentials; `409
   * access_app_has_access_points` while the provider has access points.
   */
  static async removeApplication(request, response, next) {
    try {
      const { tenant, provider } = request.params;
      await AccessAppLifecycleService.removeApplication(
        tenant,
        provider,
        scopeOf(request),
      );
      logger.info(
        `${tenant} -- ${provider} access application removed by user ${request.user?.id}`,
      );
      return response.sendStatus(204);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /:tenant/access-apps/:provider/test
   *
   * Tests the configuration the form sends, a stored secret taken for an
   * empty one while its identity stays, and records the test at the
   * provider's stored application - the source of its connection state.
   */
  static async testConnection(request, response) {
    try {
      const { tenant, provider } = request.params;
      const user = request.user;

      if (!hasTestHandler(provider)) {
        return response
          .status(400)
          .send(`No test available for provider: ${provider}`);
      }

      const result = await AccessAppLifecycleService.testConnection(
        tenant,
        provider,
        request.body,
        scopeOf(request),
      );
      logger.info(
        `${tenant} -- ${provider} access connection test by user ${user?.id}: ${result.success}`,
      );
      return response.status(200).send(result);
    } catch (err) {
      if (err instanceof BaseError) {
        return ApiResponse.fail(response, err);
      }
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
