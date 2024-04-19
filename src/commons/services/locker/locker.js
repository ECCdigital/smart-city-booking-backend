/**
 * BaseLocker is a class that represents a locker reservation system.
 * It is intended to be extended by other classes that implement the specific logic for different types of lockers.
 */
class BaseLocker {
  /**
   * Constructs a new BaseLocker instance.
   * @param {string} tenantId - The ID of the tenant reserving the locker.
   * @param {string} bookingId - The ID of the booking.
   * @param {string} unitId - The ID of the locker unit being reserved.
   */
  constructor(tenantId, bookingId, unitId) {
    this.tenantId = tenantId;
    this.bookingId = bookingId;
    this.unitId = unitId;
  }

  /**
   * Starts a new reservation.
   * This method should be overridden by subclasses.
   */
  startReservation() {
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

  startReservation() {
    console.log("ParevaLocker.startReservation");
    console.log(this.tenantId);
    console.log(this.bookingId);
    console.log(this.unitId);
  }

  updateReservation() {
    console.log("ParevaLocker.updateReservation");
  }

  cancelReservation() {
    console.log("ParevaLocker.cancelReservation");
  }
}

class LockyLocker extends BaseLocker {
  startReservation() {
    console.log("LockyLocker.startReservation");
    console.log(this.tenantId);
    console.log(this.bookingId);
    console.log(this.unitId);
  }

  updateReservation() {
    console.log("LockyLocker.updateReservation");
  }

  cancelReservation() {
    console.log("LockyLocker.cancelReservation");
  }
}

module.exports = {
  BaseLocker,
  ParevaLocker,
  LockyLocker,
};
