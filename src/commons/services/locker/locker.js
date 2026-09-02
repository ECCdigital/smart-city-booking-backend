const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const { createClient } = require("./clients/locker-client-registry");
require("./clients");
/**
 * BaseLocker is a class that represents a locker reservation system.
 * It is intended to be extended by other classes that implement the specific logic for different types of lockers.
 */
class BaseLocker {
  /**
   * Constructs a new BaseLocker instance.
   * @param {string} tenantId - The ID of the tenant reserving the locker.
   * @param {string} bookingId - The ID of the booking.
   * @param {string} id - The ID of the locker unit being reserved.
   */
  constructor(tenantId, bookingId, id) {
    this.tenantId = tenantId;
    this.bookingId = bookingId;
    this.id = id;
  }

  async getBooking() {
    return BookingManager.getBooking(this.bookingId, this.tenantId);
  }

  async getTenant() {
    return TenantManager.getTenant(this.tenantId);
  }

  /**
   * Pre-reserves a locker without fully confirming.
   * Default implementation: soft local reservation only.
   * Subclasses can override for systems that support a
   * temporary hold (e.g. iFBS getBox).
   *
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @returns {Object} The locker info object (unconfirmed).
   */
  async preReserve(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);

    locker.processId = null;
    locker.isConfirmed = false;
    locker.preReservedAt = Date.now();

    return locker;
  }

  /**
   * Starts a new reservation.
   * This method should be overridden by subclasses.
   */
  startReservation() {
    throw new Error("startReservation method must be implemented by subclass");
  }

  /**
   * Updates an existing reservation.
   * This method should be overridden by subclasses.
   */
  updateReservation() {}

  /**
   * Cancels an existing reservation.
   * This method should be overridden by subclasses.
   */
  cancelReservation() {}
}

class ParevaLocker extends BaseLocker {
  /**
   * Pre-reserves a Pareva locker.
   * Pareva has no server-side hold, so this is a local-only
   * reservation. The actual API call happens in startReservation
   * once payment is confirmed.
   */
  async preReserve(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);

    locker.processId = null;
    locker.isConfirmed = false;
    locker.preReservedAt = Date.now();

    return locker;
  }

  async startReservation(timeBegin, timeEnd) {
    try {
      const booking = await this.getBooking();
      const locker = this.getLocker(booking);
      const tenant = await this.getTenant();
      const client = createClient(this.getParevaApp(tenant));

      const rental = await client.startRental(locker.id, {
        email: booking.mail,
        fromEmail: tenant.mail,
        plannedBegin: timeBegin,
        plannedEnd: timeEnd,
      });

      locker.processId = rental.processId;
      locker.isConfirmed = true;
      delete locker.preReservedAt;
      return locker;
    } catch (err) {
      throw new Error(`${err.message}`);
    }
  }

  async updateReservation(_processId, timeBegin, timeEnd) {
    try {
      await this.cancelReservation(_processId);
      return await this.startReservation(timeBegin, timeEnd);
    } catch (err) {
      throw new Error(`${err.message}`);
    }
  }

  async cancelReservation(_processId) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking, _processId);
    const tenant = await this.getTenant();
    const { processId } = locker;
    try {
      const client = createClient(this.getParevaApp(tenant));

      if (!processId) {
        return { success: false, processId: null };
      }

      const answer = await client.cancelRental(processId);

      if (answer?.success !== true) {
        return { success: false, processId: locker.processId };
      }

      return { success: true, processId: locker.processId };
    } catch (err) {
      return { success: false, processId };
    }
  }

  getLocker(booking, processId) {
    const locker = booking.lockerInfo.find(
      (locker) =>
        locker.id === this.id &&
        (processId === undefined || locker.processId === processId),
    );
    if (!locker) throw new Error("Locker not found");
    return locker;
  }

  getParevaApp(tenant) {
    const parevaApp = tenant.applications.find(
      (app) => app.type === "locker" && app.id === "pareva" && app.active,
    );
    if (!parevaApp) throw new Error("Pareva application not found");
    return parevaApp;
  }
}

module.exports = {
  BaseLocker,
  ParevaLocker,
};
