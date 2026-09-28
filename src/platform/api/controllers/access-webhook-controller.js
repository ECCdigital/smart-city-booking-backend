const bunyan = require("bunyan");
const AccessAppLifecycleService = require("../../../commons/services/access/access-app-lifecycle-service");
const AccessService = require("../../../commons/services/access/access-service");
const {
  getAccessProvider,
} = require("../../../commons/services/access/providers/access-provider-registry");

const logger = bunyan.createLogger({
  name: "access-webhook-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessWebhookController {
  static async handle(request, response) {
    try {
      const { tenant, provider } = request.params;
      const accessProvider = getAccessProvider(provider);
      const secret = await AccessAppLifecycleService.webhookSecretOf(
        tenant,
        provider,
      );

      const verified = accessProvider.verifyWebhookSignature(
        request.body,
        request.headers,
        secret,
      );

      if (!verified) {
        return response.sendStatus(401);
      }

      const event = accessProvider.parseWebhook(request.body, request.headers);
      await AccessService.recordWebhookEvent(tenant, event);

      return response.sendStatus(200);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not process access webhook");
    }
  }
}

module.exports = AccessWebhookController;
