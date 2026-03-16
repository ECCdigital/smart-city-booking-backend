const bunyan = require("bunyan");
const { getAccessProvider } = require("./providers/access-provider-registry");
const BookingManager = require("../../data-managers/booking-manager");
const PermissionsService = require("../permission-service");

const logger = bunyan.createLogger({
  name: "access-service.js",
  level: process.env.LOG_LEVEL,
});

class AccessService {
  /**
   * Opens an access point linked to a booking.
   */
  static async open(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    const provider = getAccessProvider(accessPoint.provider);
    const result = await provider.open(accessPoint, bookingContext);

    await this._log(tenant, userId, accessPointId, bookingId, "open");
    return result;
  }

  /**
   * Closes an access point linked to a booking.
   */
  static async close(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    const provider = getAccessProvider(accessPoint.provider);
    const result = await provider.close(accessPoint, bookingContext);

    await this._log(tenant, userId, accessPointId, bookingId, "close");
    return result;
  }

  /**
   * Returns the current state of an access point.
   */
  static async getOpenStatus(tenant, bookingId, accessPointId, openBoxId) {
    const { accessPoint } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );
    const provider = getAccessProvider(accessPoint.provider);
    return provider.getOpenStatus(tenant, openBoxId);
  }

  /**
   * Returns all access points for a booking.
   */
  static async getByBooking(tenant, bookingId) {
    // TODO: DB query
  }

  /**
   * Checks if user owns the booking and it's currently active.
   */
  static async isBookingOwnerAndActive(userId, tenant, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    const isActive = booking.getIsActive();

    const hasPermission = PermissionsService._isOwner(
      booking,
      userId,
      tenant,
    );

    return hasPermission && isActive;
  }

  /**
   * @private
   * Resolves access point + builds booking context for the provider.
   */
  static async _resolve(tenant, bookingId, accessPointId) {
    const BookingManager = require("../../data-managers/booking-manager");
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    const lockerInfo = booking.lockerInfo?.find(
      (l) => String(l.processId) === String(accessPointId),
    );

    if (!lockerInfo) {
      throw new Error(
        `Access point ${accessPointId} not found in booking ${bookingId}`,
      );
    }

    return {
      accessPoint: {
        id: accessPointId,
        tenant,
        provider: lockerInfo.lockerSystem,
        type: "locker",
      },
      bookingContext: {
        tenant,
        bookingId,
        externalBookingId: lockerInfo.processId,
        lastOpenBoxId: lockerInfo.ifbsMetadata?.lastOpenBoxId,
      },
    };
  }

  /** @private */
  static async _log(tenant, userId, accessPointId, bookingId, action) {
    logger.info(
      `${tenant} -- user ${userId} performed ${action} on access-point ${accessPointId} (booking ${bookingId})`,
    );
    // TODO: Audit-Log in DB schreiben
  }
}

module.exports = AccessService;
