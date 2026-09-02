/**
 * Finishes the revokes that left an external principal behind. A revoke
 * takes the grant back at the provider and, where the grant has a principal
 * - a Salto guest - removes that too; when the second step fails, the
 * access is gone but the principal lingers. This job finds those entries
 * and asks the provider to revoke the grant again, which by the seam's
 * contract only does what is left.
 *
 * Provider-neutral: it never talks to an API client itself, only through
 * `provider.revokeAuthorization(accessPoint, grant)`.
 */

const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const AccessLogService = require("./access-log-service");
const { getAccessProvider } = require("./providers/access-provider-registry");

require("./providers/register-access-providers");

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

// What an entry records when the provider took the grant back but could not
// remove its external principal - the condition this job exists for.
const PRINCIPAL_NOT_REMOVED_ERROR =
  "The provider could not remove the external principal of the grant";

/**
 * The first of the given environment variables that is set to something,
 * so that an empty `GRANT_CLEANUP_INTERVAL_MS=` in a copied `.env` falls
 * through to the older name and the default instead of reading as zero.
 */
function envValue(...names) {
  return names.map((name) => process.env[name]).find((value) => value);
}

// Revoked, with a principal, and the principal not yet gone.
const ORPHANED_PRINCIPAL_FILTER = Object.freeze({
  accessInfo: {
    $elemMatch: {
      revokedAt: { $ne: null },
      "grant.externalPrincipalId": { $ne: null },
      $or: [
        { principalRemovedAt: { $exists: false } },
        { principalRemovedAt: null },
      ],
    },
  },
});

const logger = bunyan.createLogger({
  name: "grant-cleanup-service.js",
  level: process.env.LOG_LEVEL,
});

class GrantCleanupService {
  static _timer = null;

  /**
   * Schedules the cleanup. `GRANT_CLEANUP_INTERVAL_MS` sets the interval;
   * the former `SALTO_KS_CLEANUP_INTERVAL_MS` still counts where it is the
   * only one set. An interval of zero or less disables the job.
   *
   * @returns {void}
   */
  static start() {
    if (GrantCleanupService._timer) {
      return;
    }

    const intervalMs = Number(
      envValue("GRANT_CLEANUP_INTERVAL_MS", "SALTO_KS_CLEANUP_INTERVAL_MS") ??
        DEFAULT_INTERVAL_MS,
    );

    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      logger.warn("Grant cleanup interval disabled by configuration");
      return;
    }

    GrantCleanupService._timer = setInterval(() => {
      GrantCleanupService.cleanupPrincipals().catch((err) => {
        logger.error(`Grant cleanup failed: ${err.message}`);
      });
    }, intervalMs);

    GrantCleanupService._timer.unref?.();
    logger.info(`Grant cleanup scheduled every ${intervalMs}ms`);
  }

  /**
   * Ends the schedule; a run in progress finishes.
   *
   * @returns {void}
   */
  static stop() {
    if (GrantCleanupService._timer) {
      clearInterval(GrantCleanupService._timer);
      GrantCleanupService._timer = null;
    }
  }

  /**
   * One run over every tenant: revokes again every grant whose external
   * principal is still there, and books what became of it.
   *
   * @returns {Promise<{ tenants: number, bookings: number, principalsRemoved: number, failures: number }>}
   */
  static async cleanupPrincipals() {
    const tenants = await TenantManager.getTenants();
    const result = {
      tenants: tenants.length,
      bookings: 0,
      principalsRemoved: 0,
      failures: 0,
    };

    for (const tenant of tenants) {
      const bookings = await BookingManager.getBookingsCustomFilter(
        tenant.id,
        ORPHANED_PRINCIPAL_FILTER,
      );

      for (const booking of bookings) {
        const bookingResult =
          await GrantCleanupService._cleanupBooking(booking);
        result.principalsRemoved += bookingResult.principalsRemoved;
        result.failures += bookingResult.failures;
        if (bookingResult.changed) {
          result.bookings += 1;
          await BookingManager.storeBooking(booking);
        }
      }
    }

    if (result.principalsRemoved > 0 || result.failures > 0) {
      logger.info(
        `Grant cleanup done: ${result.principalsRemoved} principals removed, ${result.failures} failed`,
      );
    }

    return result;
  }

  /**
   * @private
   * Revokes again every entry of the booking that still holds a principal,
   * changing the entries in place.
   *
   * @param {Object} booking The booking whose entries are to be cleaned
   * @returns {Promise<{ changed: boolean, principalsRemoved: number, failures: number }>}
   *   Whether the booking is to be stored, and what the run achieved
   */
  static async _cleanupBooking(booking) {
    let changed = false;
    let principalsRemoved = 0;
    let failures = 0;

    for (const info of booking.accessInfo || []) {
      if (!GrantCleanupService._needsCleanup(info)) {
        continue;
      }

      const now = Date.now();
      const accessPoint = GrantCleanupService._toAccessPoint(booking, info);
      const grant = {
        authorizationId: info.grant.authorizationId,
        externalPrincipalId: info.grant.externalPrincipalId,
        secret: null,
      };
      info.principalCleanupAttemptedAt = now;
      changed = true;

      try {
        const provider = getAccessProvider(info.provider);
        const revocation = await provider.revokeAuthorization(
          accessPoint,
          grant,
        );

        if (revocation.principalRemoved === true) {
          info.principalRemovedAt = now;
          info.principalCleanupError = null;
          principalsRemoved += 1;
          await GrantCleanupService._log(booking, info, "success", {
            revocation,
          });
        } else {
          info.principalCleanupError = PRINCIPAL_NOT_REMOVED_ERROR;
          failures += 1;
          await GrantCleanupService._log(booking, info, "failure", {
            revocation,
            errorMessage: info.principalCleanupError,
          });
        }
      } catch (err) {
        info.principalCleanupError = err.message;
        failures += 1;
        await GrantCleanupService._log(booking, info, "failure", {
          errorMessage: err.message,
        });
      }
    }

    return { changed, principalsRemoved, failures };
  }

  /**
   * @private
   * The database filter narrowed down again in memory: a booking matched on
   * one entry may carry others that need nothing.
   */
  static _needsCleanup(info) {
    return (
      !!info?.revokedAt &&
      !!info.grant?.externalPrincipalId &&
      !info.principalRemovedAt
    );
  }

  /**
   * @private
   * The access point as the provider needs it for a revoke, rebuilt from
   * the entry: the door may have been deleted since, the grant still has
   * to go.
   */
  static _toAccessPoint(booking, info) {
    return {
      id: info.accessPointId,
      tenantId: booking.tenantId,
      type: info.accessPointType || "door",
      provider: info.provider,
      externalId: info.externalId,
      mode: info.mode,
    };
  }

  /**
   * @private
   * Books the retried revoke in the audit log as a `revoke` by the system,
   * marked `cleanup`. A log that cannot be written never fails the run.
   *
   * @param {Object} booking The booking the entry belongs to
   * @param {Object} info The accessInfo entry that was cleaned
   * @param {"success"|"failure"} result What the retry achieved
   * @param {Object} [details]
   * @param {import("./providers/access-provider").Revocation} [details.revocation]
   * @param {string} [details.errorMessage]
   * @returns {Promise<void>}
   */
  static async _log(booking, info, result, { revocation, errorMessage } = {}) {
    try {
      await AccessLogService.log({
        tenantId: booking.tenantId,
        bookingId: booking.id,
        accessPointId: info.accessPointId,
        accessPointType: info.accessPointType || "door",
        provider: info.provider,
        externalId: info.externalId,
        action: "revoke",
        actor: { source: "system" },
        result,
        payload: {
          grant: {
            authorizationId: info.grant.authorizationId,
            externalPrincipalId: info.grant.externalPrincipalId,
          },
          revocation: revocation || null,
          cleanup: true,
        },
        errorMessage: errorMessage || null,
      });
    } catch (err) {
      logger.error(`Failed to write grant cleanup log: ${err.message}`);
    }
  }
}

GrantCleanupService.PRINCIPAL_NOT_REMOVED_ERROR = PRINCIPAL_NOT_REMOVED_ERROR;

module.exports = GrantCleanupService;
