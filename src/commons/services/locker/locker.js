const BookingManager = require("../../data-managers/booking-manager");

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
  startReservation() {}

  /**
   * Updates an existing reservation.
   * This method should be overridden by subclasses.
   */
  updateReservation(timeBegin, timeEnd) {}

  /**
   * Cancels an existing reservation.
   * This method should be overridden by subclasses.
   */
  cancelReservation(unitId) {}
}

class ParevaLocker extends BaseLocker {
  async startReservation(timeBegin, timeEnd) {
    const booking = await BookingManager.getBooking(
      this.bookingId,
      this.tenantId,
    );

    // ToDo: Call Pareva API to start reservation
    let response;

    const processId = Math.random() * 1000;

    await new Promise(resolve => setTimeout(() => {
      response = { test: 1231, processId: processId };
      resolve();
    }, 1000));

    const updatedLockerInfo = booking.lockerInfo.find(
      (locker) => locker.id === this.unitId,
    );
    updatedLockerInfo.processId = response.processId;

    return updatedLockerInfo
  }

  async updateReservation(timeBegin, timeEnd) {
    console.log("ParevaLocker.updateReservation");
    try {
      await this.cancelReservation(this.unitId);
      return await this.startReservation(timeBegin,timeEnd);
    } catch (err) {
      console.error(err);
      throw new Error("Unable to update reservation");
    }
  }

  async cancelReservation(unitId) {
    try {
      console.log("ParevaLocker.cancelReservation", unitId);
      await new Promise(resolve => setTimeout(() => {
        resolve();
      }, 1000));
    } catch (err) {
      console.error(err);
      throw new Error("Unable to cancel reservation");
    }
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

  async cancelReservation(unitId) {
    console.log("LockyLocker.cancelReservation", unitId);
  }
}

module.exports = {
  BaseLocker,
  ParevaLocker,
  LockyLocker,
};
