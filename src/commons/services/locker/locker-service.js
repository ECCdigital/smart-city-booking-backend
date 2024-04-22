const { getBookable } = require("../../data-managers/bookable-manager");
const { getTenantAppByType } = require("../../data-managers/tenant-manager");
const {
  getConcurrentBookings,
  getBooking,
  getBookingsByTimeRange,
} = require("../../data-managers/booking-manager");
const { ParevaLocker, LockyLocker } = require("./locker");

const APP_TYPE = "locker";

const LOCKER_TYPE = {
  PAREVA: "pareva",
  LOCKY: "locky",
};

/**
 * LockerService is a singleton class that provides methods for managing lockers.
 * It includes methods for getting available lockers, checking locker availability,
 * handling the creation of lockers, reserving and freeing lockers, and more.
 */
class LockerService {
  static instance = null;

  /**
   * Returns the singleton instance of the LockerService class.
   * If the instance does not exist, it is created.
   * Also, it cleans up the reserved lockers.
   * @returns {LockerService} The singleton instance of the LockerService class.
   */
  static getInstance() {
    if (LockerService.instance === null) {
      LockerService.instance = new LockerService();
    }
    LockerService.cleanupReservedLockers();
    return LockerService.instance;
  }
  constructor() {
    if (LockerService.instance !== null) {
      throw new Error(
        "Cannot create multiple instances of LockerService, use LockerService.getInstance()",
      );
    }
  }

  /**
   * An array of locker objects that have been reserved.
   * Each locker object includes the tenantId, unitId, lockerSystem, startTime, endTime, and reserveTime.
   * @type {Array}
   */
  static reservedLockers = [];

  /**
   * Gets the available locker for the given bookableId, tenantId, timeBegin, timeEnd, and amount.
   * It throws an error if the bookable resource is not found or if there are not enough lockers available.
   * @param {string} bookableId - The ID of the bookable resource.
   * @param {string} tenantId - The ID of the tenant.
   * @param {number} timeBegin - The start time for the locker reservation.
   * @param {number} timeEnd - The end time for the locker reservation.
   * @param {number} amount - The number of lockers to reserve.
   * @returns {Array} An array of locker units that have been reserved.
   */
  async getAvailableLocker(bookableId, tenantId, timeBegin, timeEnd, amount) {
    try {
      const bookable = await getBookable(bookableId, tenantId);
      if (!bookable) {
        throw new Error("Bookable resource not found");
      }

      const lockerApps = await getTenantAppByType(tenantId, APP_TYPE);
      const bookableLockerDetails = bookable.lockerDetails;
      const activeLockerApps = LockerService.getActiveLockerApps(lockerApps);

      if (bookableLockerDetails.active && activeLockerApps.length > 0) {
        let occupiedUnits = [];
        const possibleUnits = bookableLockerDetails.units;
        const concurrentBookings = await getConcurrentBookings(
          bookableId,
          tenantId,
          timeBegin,
          timeEnd,
        );

        if (concurrentBookings.length > 0) {
          occupiedUnits = concurrentBookings
            .filter((booking) => booking.lockerInfo)
            .map((booking) => booking.lockerInfo)
            .flat();
        }

        const activeLockerAppIds = activeLockerApps.map((app) => app.id);
        const availableUnits = possibleUnits.filter((unit) => {
          const isOccupied = occupiedUnits.some(
            (occupiedUnit) =>
              occupiedUnit.id === unit.id &&
              occupiedUnit.lockerSystem === unit.lockerSystem,
          );
          const isReserved = LockerService.isLockerReserved(
            unit.tenantId,
            unit.id,
            unit.lockerSystem,
            timeBegin,
            timeEnd,
          );
          return (
            !isReserved &&
            !isOccupied &&
            activeLockerAppIds.includes(unit.lockerSystem)
          );
        });

        if (availableUnits.length < amount) {
          throw new Error("Not enough lockers available");
        }

        const units = availableUnits.slice(0, amount);
        units.forEach((unit) => {
          LockerService.reserveLocker(
            tenantId,
            unit.id,
            unit.lockerSystem,
            timeBegin,
            timeEnd,
          );
        });

        return units;
      } else {
        return [];
      }
    } catch (error) {
      throw new Error(`Error in getting available lockers: ${error.message}`);
    }
  }

  /**
   * Checks the availability of the locker for the given tenantId, unitId, timeBegin, and timeEnd.
   * It throws an error if there is an error in getting the booking.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} unitId - The ID of the locker unit.
   * @param {number} timeBegin - The start time for the locker reservation.
   * @param {number} timeEnd - The end time for the locker reservation.
   * @returns {boolean} True if the locker is available, false otherwise.
   */
  async checkLockerAvailability(tenantId, unitId, timeBegin, timeEnd) {
    try {
      const booking = await getBookingsByTimeRange(
        tenantId,
        timeBegin,
        timeEnd,
      );
      if (booking.length === 0) {
        return true;
      }

      const lockerInfo = booking.map((book) => book.lockerInfo).flat();
      return lockerInfo.every((unit) => unit.id !== unitId);
    } catch (error) {
      throw new Error(`Error in getting booking: ${error.message}`);
    }
  }

  /**
   * Handles the creation of the locker for the given tenantId and bookingId.
   * It throws an error if the booking is not found or if there is an error in getting the booking.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} bookingId - The ID of the booking.
   */
  async handleCreate(tenantId, bookingId) {
    try {
      const booking = await getBooking(bookingId, tenantId);
      if (!booking) {
        throw new Error("Booking not found");
      }
      const lockerUnitsToBeAssigned = LockerService.assignedLocker(booking);
      if (lockerUnitsToBeAssigned.length === 0) {
        return;
      }

      for (const unit of lockerUnitsToBeAssigned) {
        let locker;
        switch (unit.lockerSystem) {
          case LOCKER_TYPE.PAREVA:
            locker = new ParevaLocker(booking.tenant, booking.id, unit.id);
            break;
          case LOCKER_TYPE.LOCKY:
            locker = new LockyLocker(booking.tenant, booking.id, unit.id);
            break;
          default:
            throw new Error("Unsupported locker type");
        }
        await locker.startReservation();
        LockerService.freeReservedLocker(
          booking.tenant,
          unit.id,
          unit.lockerSystem,
          booking.timeBegin,
          booking.timeEnd,
        );
      }
    } catch (error) {
      throw new Error(`Error in getting booking: ${error.message}`);
    }
  }

  async handleUpdate(bookingId, tenantId) {}

  async handleCancel(bookingId, tenantId) {}

  /**
   * Reserves a locker for the given tenantId, unitId, lockerSystem, startTime, endTime, and reserveTime.
   * The locker is added to the reservedLockers array.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} unitId - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} startTime - The start time for the locker reservation.
   * @param {number} endTime - The end time for the locker reservation.
   * @param {number} [reserveTime=Date.now()] - The time when the locker was reserved.
   */
  static reserveLocker(
    tenantId,
    unitId,
    lockerSystem,
    startTime,
    endTime,
    reserveTime = Date.now(),
  ) {
    LockerService.reservedLockers.push({
      tenantId,
      unitId,
      lockerSystem,
      startTime,
      endTime,
      reserveTime,
    });
  }

  /**
   * Frees a reserved locker for the given tenantId, unitId, lockerSystem, startTime, and endTime.
   * The locker is removed from the reservedLockers array.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} unitId - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} startTime - The start time for the locker reservation.
   * @param {number} endTime - The end time for the locker reservation.
   */
  static freeReservedLocker(
    tenantId,
    unitId,
    lockerSystem,
    startTime,
    endTime,
  ) {
    LockerService.reservedLockers = LockerService.reservedLockers.filter(
      (locker) => {
        return (
          locker.tenantId !== tenantId &&
          locker.unitId !== unitId &&
          locker.lockerSystem !== lockerSystem &&
          locker.startTime !== startTime &&
          locker.endTime !== endTime
        );
      },
    );
  }

  /**
   * Checks if a locker is reserved for the given tenantId, unitId, lockerSystem, timeBegin, and timeEnd.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} unitId - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} timeBegin - The start time for the locker reservation.
   * @param {number} timeEnd - The end time for the locker reservation.
   * @returns {boolean} True if the locker is reserved, false otherwise.
   */
  static isLockerReserved(tenantId, unitId, lockerSystem, timeBegin, timeEnd) {
    return LockerService.reservedLockers.some(
      (locker) =>
        locker.tenantId === tenantId &&
        locker.unitId === unitId &&
        locker.lockerSystem === lockerSystem &&
        locker.startTime <= timeBegin &&
        locker.endTime >= timeEnd,
    );
  }

  /**
   * Cleans up the reserved lockers.
   * It removes any lockers from the reservedLockers array whose reserveTime is not more than 15 minutes in the past.
   */
  static cleanupReservedLockers() {
    LockerService.reservedLockers = LockerService.reservedLockers.filter(
      (locker) => locker.reserveTime > Date.now() - 1000 * 60 * 15,
    );
  }

  /**
   * Gets the active locker apps from the given lockerApps array.
   * @param {Array} lockerApps - An array of locker apps.
   * @returns {Array} An array of active locker apps.
   */
  static getActiveLockerApps(lockerApps) {
    return lockerApps.filter((app) => app.active);
  }

  /**
   * Gets the assigned locker from the given booking.
   * @param {Object} booking - The booking object.
   * @returns {Array} An array of locker units that have been assigned.
   */
  static assignedLocker(booking) {
    return booking.lockerInfo;
  }
}

module.exports = LockerService;
