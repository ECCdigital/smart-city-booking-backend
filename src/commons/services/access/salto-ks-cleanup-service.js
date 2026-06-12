const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const AccessLogService = require("./access-log-service");
const { createClient } = require("./clients/access-client-registry");

require("./clients");

const PROVIDER_ID = "salto-ks";
const APP_TYPE = "access";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

const logger = bunyan.createLogger({
  name: "salto-ks-cleanup-service.js",
  level: process.env.LOG_LEVEL,
});

class SaltoKsCleanupService {
  static _timer = null;

  static start() {
    if (SaltoKsCleanupService._timer) {
      return;
    }

    const intervalMs = Number(
      process.env.SALTO_KS_CLEANUP_INTERVAL_MS || DEFAULT_INTERVAL_MS,
    );

    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      logger.warn("Salto KS cleanup interval disabled by configuration");
      return;
    }

    SaltoKsCleanupService._timer = setInterval(() => {
      SaltoKsCleanupService.cleanupOrphanedUsers().catch((err) => {
        logger.error(`Salto KS cleanup failed: ${err.message}`);
      });
    }, intervalMs);

    SaltoKsCleanupService._timer.unref?.();
    logger.info(`Salto KS cleanup scheduled every ${intervalMs}ms`);
  }

  static stop() {
    if (SaltoKsCleanupService._timer) {
      clearInterval(SaltoKsCleanupService._timer);
      SaltoKsCleanupService._timer = null;
    }
  }

  static async cleanupOrphanedUsers() {
    const tenants = await TenantManager.getTenants();
    const result = { tenants: 0, bookings: 0, deletedUsers: 0, failures: 0 };

    for (const tenant of tenants) {
      const app = SaltoKsCleanupService._getActiveApp(tenant);
      if (!app) {
        continue;
      }

      result.tenants += 1;
      const client = createClient(app);
      const bookings = await BookingManager.getBookingsCustomFilter(tenant.id, {
        accessInfo: {
          $elemMatch: {
            provider: PROVIDER_ID,
            isProvisioned: false,
            saltoUserId: { $exists: true, $ne: null },
            $or: [
              { saltoUserDeletedAt: { $exists: false } },
              { saltoUserDeletedAt: null },
            ],
          },
        },
      });

      for (const booking of bookings) {
        const bookingResult = await SaltoKsCleanupService._cleanupBookingUsers(
          client,
          booking,
        );
        result.deletedUsers += bookingResult.deletedUsers;
        result.failures += bookingResult.failures;
        if (bookingResult.changed) {
          result.bookings += 1;
          await BookingManager.storeBooking(booking);
        }
      }
    }

    if (result.deletedUsers > 0 || result.failures > 0) {
      logger.info(
        `Salto KS cleanup done: ${result.deletedUsers} deleted, ${result.failures} failed`,
      );
    }

    return result;
  }

  static async _cleanupBookingUsers(client, booking) {
    let changed = false;
    let deletedUsers = 0;
    let failures = 0;

    for (const info of booking.accessInfo || []) {
      if (!SaltoKsCleanupService._shouldCleanup(info)) {
        continue;
      }

      info.saltoUserCleanupAttemptedAt = Date.now();

      try {
        await client.deleteUser(info.saltoUserId);
        info.saltoUserDeletedAt = Date.now();
        info.saltoUserCleanupError = null;
        deletedUsers += 1;
        changed = true;
        await SaltoKsCleanupService._log(booking, info, "success");
      } catch (err) {
        if (err.response?.status === 404) {
          info.saltoUserDeletedAt = Date.now();
          info.saltoUserCleanupError = null;
          deletedUsers += 1;
          changed = true;
          await SaltoKsCleanupService._log(booking, info, "success", {
            alreadyDeleted: true,
          });
          continue;
        }

        info.saltoUserCleanupError = err.message;
        failures += 1;
        changed = true;
        await SaltoKsCleanupService._log(booking, info, "failure", {
          errorMessage: err.message,
        });
      }
    }

    return { changed, deletedUsers, failures };
  }

  static _shouldCleanup(info) {
    return (
      info?.provider === PROVIDER_ID &&
      info.isProvisioned === false &&
      !!info.saltoUserId &&
      !info.saltoUserDeletedAt
    );
  }

  static _getActiveApp(tenant) {
    return (tenant.applications || []).find(
      (app) => app.type === APP_TYPE && app.id === PROVIDER_ID && app.active,
    );
  }

  static async _log(booking, info, result, payload = {}) {
    try {
      await AccessLogService.log({
        tenantId: booking.tenantId,
        bookingId: booking.id,
        accessPointId: info.accessPointId,
        accessPointType: info.accessPointType || "door",
        provider: PROVIDER_ID,
        externalId: info.externalId,
        action: "cleanup",
        actor: { source: "system" },
        result,
        payload: {
          saltoUserId: info.saltoUserId,
          accessId: info.accessId || info.authorizationId || null,
          ...payload,
        },
        errorMessage: payload.errorMessage || null,
      });
    } catch (err) {
      logger.error(`Failed to write Salto KS cleanup log: ${err.message}`);
    }
  }
}

module.exports = SaltoKsCleanupService;
