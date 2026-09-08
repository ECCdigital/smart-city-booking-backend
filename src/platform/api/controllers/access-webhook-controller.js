const bunyan = require("bunyan");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const AccessLogService = require("../../../commons/services/access/access-log-service");
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
      const secret = await AccessWebhookController._getWebhookSecret(
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
      await AccessWebhookController._persistEvent(tenant, event);

      return response.sendStatus(200);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not process access webhook");
    }
  }

  static async _persistEvent(tenant, event) {
    const bookings = await BookingManager.getBookingsCustomFilter(tenant, {
      "accessInfo.provider": event.provider,
      "accessInfo.externalId": event.externalId,
    });
    const timestamp =
      typeof event.timestamp === "number"
        ? event.timestamp
        : new Date(event.timestamp || Date.now()).getTime();

    for (const booking of bookings) {
      let changed = false;
      booking.accessInfo = (booking.accessInfo || []).map((info) => {
        if (
          info.provider !== event.provider ||
          String(info.externalId) !== String(event.externalId)
        ) {
          return info;
        }

        changed = true;
        return {
          ...info,
          lastEvent: {
            type: event.eventType || "webhook",
            timestamp,
            source: "webhook",
            success: event.success !== false,
            errorCode: event.errorCode || null,
          },
        };
      });

      if (changed) {
        await BookingManager.storeBooking(booking);
      }

      await AccessLogService.log({
        tenantId: tenant,
        bookingId: booking.id,
        accessPointId: AccessWebhookController._findAccessPointId(
          booking,
          event,
        ),
        accessPointType: "door",
        provider: event.provider,
        externalId: event.externalId,
        action: "webhook",
        actor: { source: "webhook" },
        result: event.success === false ? "failure" : "success",
        payload: event.payload || event,
        errorCode: event.errorCode || null,
      });
    }
  }

  static _findAccessPointId(booking, event) {
    const info = (booking.accessInfo || []).find(
      (entry) =>
        entry.provider === event.provider &&
        String(entry.externalId) === String(event.externalId),
    );
    return info?.accessPointId || null;
  }

  static async _getWebhookSecret(tenantId, provider) {
    const tenant = await TenantManager.getTenant(tenantId);
    const app = (tenant?.applications || []).find(
      (a) => a.type === "access" && a.id === provider && a.active,
    );

    return app?.webhookSecret || app?.notificationSecret || null;
  }
}

module.exports = AccessWebhookController;
