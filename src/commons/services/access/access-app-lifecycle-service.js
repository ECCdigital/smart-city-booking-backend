const bunyan = require("bunyan");
const { createClient } = require("./clients/access-client-registry");

require("./clients");

const APP_TYPE = "access";
const AUTO_REGISTER_PROVIDERS = Object.freeze(["salto-ks"]);

const logger = bunyan.createLogger({
  name: "access-app-lifecycle-service.js",
  level: process.env.LOG_LEVEL,
});

class AccessAppLifecycleService {
  static async syncWebhooks(previousTenant, nextTenant) {
    if (!Array.isArray(nextTenant?.applications)) {
      return nextTenant;
    }

    for (const app of nextTenant.applications) {
      if (app.type !== APP_TYPE || !AUTO_REGISTER_PROVIDERS.includes(app.id)) {
        continue;
      }

      const previousApp = AccessAppLifecycleService._findApp(
        previousTenant,
        app.id,
      );
      const callbackUrl =
        app.webhookCallbackUrl ||
        AccessAppLifecycleService._buildCallbackUrl(nextTenant.id, app.id);

      if (app.active) {
        await AccessAppLifecycleService._ensureRegistered(
          nextTenant.id,
          app,
          previousApp,
          callbackUrl,
        );
      } else {
        await AccessAppLifecycleService._ensureUnregistered(
          nextTenant.id,
          app,
          previousApp,
        );
      }
    }

    return nextTenant;
  }

  static async _ensureRegistered(tenantId, app, previousApp, callbackUrl) {
    if (!callbackUrl) {
      app.webhookRegistrationError =
        "Missing ACCESS_WEBHOOK_BASE_URL or BACKEND_URL";
      return;
    }

    if (
      !app.webhookSubscriptionId &&
      previousApp?.active &&
      previousApp.webhookSubscriptionId &&
      (!previousApp.webhookCallbackUrl ||
        previousApp.webhookCallbackUrl === callbackUrl)
    ) {
      app.webhookSubscriptionId = previousApp.webhookSubscriptionId;
      app.webhookRegisteredAt = previousApp.webhookRegisteredAt || null;
    }

    const hasCurrentSubscription =
      app.webhookSubscriptionId &&
      (app.webhookCallbackUrl || callbackUrl) === callbackUrl;

    if (hasCurrentSubscription) {
      app.webhookCallbackUrl = callbackUrl;
      app.webhookRegistrationError = null;
      return;
    }

    if (
      previousApp?.webhookSubscriptionId &&
      previousApp.webhookCallbackUrl &&
      previousApp.webhookCallbackUrl !== callbackUrl
    ) {
      await AccessAppLifecycleService._unregister(
        tenantId,
        previousApp,
        previousApp.webhookSubscriptionId,
      );
    }

    try {
      const client = createClient(app);
      const result = await client.registerNotification(callbackUrl);
      app.webhookSubscriptionId =
        AccessAppLifecycleService._extractSubscriptionId(result);
      app.webhookCallbackUrl = callbackUrl;
      app.webhookRegisteredAt = Date.now();
      app.webhookRegistrationError = null;
      logger.info(
        `${tenantId} -- registered ${app.id} access webhook (${app.webhookSubscriptionId || "no id returned"})`,
      );
    } catch (err) {
      app.webhookRegistrationError = err.message;
      logger.error(
        `${tenantId} -- failed to register ${app.id} access webhook: ${err.message}`,
      );
    }
  }

  static async _ensureUnregistered(tenantId, app, previousApp) {
    const subscriptionId =
      app.webhookSubscriptionId || previousApp?.webhookSubscriptionId;

    if (!subscriptionId) {
      app.webhookSubscriptionId = null;
      app.webhookRegisteredAt = null;
      return;
    }

    try {
      await AccessAppLifecycleService._unregister(
        tenantId,
        previousApp || app,
        subscriptionId,
      );
      app.webhookSubscriptionId = null;
      app.webhookRegisteredAt = null;
      app.webhookRegistrationError = null;
      logger.info(`${tenantId} -- unregistered ${app.id} access webhook`);
    } catch (err) {
      app.webhookSubscriptionId = subscriptionId;
      app.webhookRegistrationError = err.message;
      logger.error(
        `${tenantId} -- failed to unregister ${app.id} access webhook: ${err.message}`,
      );
    }
  }

  static async _unregister(tenantId, app, subscriptionId) {
    if (!subscriptionId) {
      return;
    }

    const client = createClient(app);
    await client.unregisterNotification(subscriptionId);
    logger.info(
      `${tenantId} -- removed ${app.id} subscription ${subscriptionId}`,
    );
  }

  static _extractSubscriptionId(result) {
    return (
      result?.subscriptionId ||
      result?.notificationId ||
      result?.id ||
      result?.subscription?.id ||
      null
    );
  }

  static _buildCallbackUrl(tenantId, providerId) {
    const baseUrl =
      process.env.ACCESS_WEBHOOK_BASE_URL || process.env.BACKEND_URL;

    if (!baseUrl) {
      return null;
    }

    return `${baseUrl.replace(/\/$/, "")}/api/webhooks/access/${providerId}/${tenantId}`;
  }

  static _findApp(tenant, providerId) {
    return (tenant?.applications || []).find(
      (app) => app.type === APP_TYPE && app.id === providerId,
    );
  }
}

module.exports = AccessAppLifecycleService;
