const { BookableManager } = require("../../data-managers/bookable-manager");
const { getTenantAppByType } = require("../../data-managers/tenant-manager");
const BookingManager = require("../../data-managers/booking-manager");
const {
  getConcurrentBookings,
  getBooking,
  getBookingsByTimeRange,
} = require("../../data-managers/booking-manager");
const { ParevaLocker } = require("./locker");

const APP_TYPE = "locker";

const LOCKER_TYPE = {
  PAREVA: "pareva",
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
   * This asynchronous function is used to get available lockers for a specific booking.
   * It first retrieves the bookable resource and checks if it exists. If not, it throws an error.
   * Then it retrieves the locker applications for the tenant and checks if there are any active locker applications.
   * If there are active locker applications and the bookable resource is active, it calculates the occupied units and possible units.
   * It then filters the possible units to get the available units.
   * If the number of available units is less than the requested amount, it throws an error.
   * Otherwise, it reserves the lockers and returns the units.
   *
   * @async
   * @param {string} bookableId - The ID of the bookable resource.
   * @param {string} tenantId - The ID of the tenant.
   * @param {number} timeBegin - The start time for the locker reservation.
   * @param {number} timeEnd - The end time for the locker reservation.
   * @param {number} amount - The number of lockers to reserve.
   * @returns {Array} An array of locker units that have been reserved.
   * @throws {Error} If the bookable resource is not found or if there are not enough lockers available.
   */
  async getAvailableLocker(bookableId, tenantId, timeBegin, timeEnd, amount) {
    try {
      const bookable = await BookableManager.getBookable(bookableId, tenantId);
      if (!bookable) {
        throw new Error("Bookable resource not found");
      }

      const lockerApps = await getTenantAppByType(tenantId, APP_TYPE);
      const bookableLockerDetails = bookable.lockerDetails;
      const activeLockerApps = LockerService.getActiveLockerApps(lockerApps);

      if (bookableLockerDetails.active === true && activeLockerApps.length > 0) {
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

        const calculateRemainingAmount = (unit) => {
          const occupiedUnitsWithSameId = occupiedUnits.filter(
            (occupiedUnit) =>
              occupiedUnit.id === unit.id &&
              occupiedUnit.lockerSystem === unit.lockerSystem,
          );
          return Number(unit.amount) - occupiedUnitsWithSameId.length;
        };

        const availableUnits = possibleUnits.flatMap((unit) => {
          const remainingAmount = calculateRemainingAmount(unit);
          const isOccupied = remainingAmount <= 0;
          const isReserved = LockerService.isLockerReserved(
            tenantId,
            unit.id,
            unit.lockerSystem,
            timeBegin,
            timeEnd,
            remainingAmount,
            Number(unit.amount),
          );

          if (
            !isReserved &&
            !isOccupied &&
            activeLockerAppIds.includes(unit.lockerSystem)
          ) {
            return Array(remainingAmount).fill({
              id: unit.id,
              lockerSystem: unit.lockerSystem,
            });
          } else {
            return [];
          }
        });
        if (availableUnits.length < amount) {
          throw new Error("Not enough lockers available");
        }

        const units = availableUnits.slice(0, amount).map((unit) => ({
          id: unit.id,
          lockerSystem: unit.lockerSystem,
          bookableId,
          isConfirmed: false,
        }));

        units.forEach((unit) => {
          LockerService.reserveLocker(
            tenantId,
            bookableId,
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
            locker = new ParevaLocker(booking.tenantId, booking.id, unit.id);
            break;
          default:
            throw new Error("Unsupported locker type");
        }
        const updatedLockerInfo = await locker.startReservation(
          booking.timeBegin,
          booking.timeEnd,
        );
        booking.lockerInfo = booking.lockerInfo.map((locker) => {
          if (locker.id === updatedLockerInfo.id) {
            return updatedLockerInfo;
          }
          return locker;
        });
        LockerService.freeReservedLocker(
          booking.tenantId,
          unit.id,
          unit.lockerSystem,
          booking.timeBegin,
          booking.timeEnd,
        );
      }
      await BookingManager.storeBooking(booking);
    } catch (error) {
      throw new Error(`Error in getting booking: ${error.message}`);
    }
  }

  /**
   * Handles the update of a booking.
   *
   * This method is responsible for updating a booking and managing the associated locker units.
   * It compares the old and updated booking, determines the changes, and performs the necessary actions.
   * These actions can include cancelling, assigning, and updating locker units.
   *
   * The method throws an error if there is an issue retrieving the booking.
   *
   * @async
   * @param {string} tenantId - The ID of the tenant.
   * @param {Object} oldBooking - The booking object before the update.
   * @param {Object} updatedBooking - The booking object after the update.
   * @throws {Error} If there is an error in getting the booking.
   */
  async handleUpdate(tenantId, oldBooking, updatedBooking) {
    try {
      const changedBookingTime = !(
        oldBooking.timeBegin === updatedBooking.timeBegin &&
        oldBooking.timeEnd === updatedBooking.timeEnd
      );

      const getDifference = (oldBooking, updatedBooking) => {
        const oldBookableItems = oldBooking.bookableItems;
        const newBookableItems = updatedBooking.bookableItems;

        const itemsRemoved = oldBookableItems.filter(
          (oldItem) =>
            !newBookableItems.some(
              (newItem) => newItem.bookableId === oldItem.bookableId,
            ),
        );

        const itemsAdded = newBookableItems.filter(
          (newItem) =>
            !oldBookableItems.some(
              (oldItem) => oldItem.bookableId === newItem.bookableId,
            ),
        );

        const itemsWithQuantityChanges = oldBookableItems
          .map((oldItem) => {
            const newItem = newBookableItems.find(
              (newItem) => newItem.bookableId === oldItem.bookableId,
            );
            if (newItem && newItem.amount !== oldItem.amount) {
              return {
                bookableId: oldItem.bookableId,
                oldAmount: oldItem.amount,
                newAmount: newItem.amount,
                quantityChange: newItem.amount - oldItem.amount,
                changeType:
                  newItem.amount > oldItem.amount ? "increased" : "decreased",
              };
            }
            return null;
          })
          .filter((item) => item !== null);

        const unchangedItems = oldBookableItems.filter((oldItem) =>
          newBookableItems.some(
            (newItem) =>
              newItem.bookableId === oldItem.bookableId &&
              newItem.amount === oldItem.amount,
          ),
        );

        return {
          itemsRemoved,
          itemsAdded,
          itemsWithQuantityChanges,
          unchangedItems,
        };
      };

      const {
        itemsRemoved,
        itemsAdded,
        itemsWithQuantityChanges,
        unchangedItems,
      } = getDifference(oldBooking, updatedBooking);

      let oldLockerUnits = LockerService.assignedLocker(oldBooking);

      const processLocker = async (
        unit,
        action,
        tenantId,
        bookingId,
        timeBegin,
        timeEnd,
      ) => {
        let locker;
        switch (unit.lockerSystem) {
          case LOCKER_TYPE.PAREVA:
            locker = new ParevaLocker(tenantId, bookingId, unit.id);
            break;
          default:
            throw new Error("Unsupported locker type");
        }
        if (action === "cancel") {
          return await locker.cancelReservation(unit.id);
        } else if (action === "start") {
          return await locker.startReservation(timeBegin, timeEnd);
        } else if (action === "update") {
          return await locker.updateReservation(timeBegin, timeEnd);
        }
      };

      const cancelLockers = async (items, units) => {
        for (const item of items) {
          let filteredUnitsToBeCanceled = units.filter((unit) =>
            itemsRemoved.find(
              (removedItem) => removedItem.bookableId === unit.bookableId,
            ),
          );

          await Promise.all(
            filteredUnitsToBeCanceled.map(async (unit) => {
              try {
                const result = await processLocker(
                  unit,
                  "cancel",
                  oldBooking.tenantId,
                  oldBooking.id,
                );

                if (result.success) {
                  updatedBooking.lockerInfo = updatedBooking.lockerInfo.filter(
                    (locker) => locker.processId !== result.processId,
                  );
                }
              } catch (error) {
                console.log(`Error in canceling reservation: ${error.message}`);
              }
            }),
          );

          oldLockerUnits = oldLockerUnits.filter((locker) =>
            filteredUnitsToBeCanceled.every((unit) => unit.id !== locker.id),
          );
        }
      };

      const assignLockers = async (item, booking, quantity) => {
        const lockerUnitsToBeAssigned = await this.getAvailableLocker(
          item.bookableId,
          booking.tenantId,
          booking.timeBegin,
          booking.timeEnd,
          quantity,
        );
        if (lockerUnitsToBeAssigned.length === 0) {
          return;
        }
        oldBooking.lockerInfo = oldBooking.lockerInfo.concat(
          lockerUnitsToBeAssigned,
        );
        booking.lockerInfo = booking.lockerInfo.concat(lockerUnitsToBeAssigned);
        await BookingManager.storeBooking(oldBooking);

        const updatedLockerInfo = await Promise.all(
          lockerUnitsToBeAssigned.map(async (unit) => {
            return processLocker(
              unit,
              "start",
              booking.tenantId,
              booking.id,
              booking.timeBegin,
              booking.timeEnd,
            );
          }),
        );

        booking.lockerInfo = booking.lockerInfo.map(
          (locker) =>
            updatedLockerInfo.find((info) => info && info.id === locker.id) ||
            locker,
        );

        await Promise.all(
          lockerUnitsToBeAssigned.map((unit) => {
            return LockerService.freeReservedLocker(
              booking.tenantId,
              unit.id,
              unit.lockerSystem,
              booking.timeBegin,
              booking.timeEnd,
            );
          }),
        );
      };

      const handleQuantityChanges = async (items, units, booking) => {
        for (const item of items) {
          if (item.changeType === "decreased") {
            let canceledUnits = units
              .filter((unit) => unit.bookableId === item.bookableId)
              .slice(0, Math.abs(item.quantityChange));

            await Promise.all(
              canceledUnits.map(async (unit) => {
                try {
                  await processLocker(
                    unit,
                    "cancel",
                    oldBooking.tenantId,
                    oldBooking.id,
                  );
                  booking.lockerInfo = booking.lockerInfo.filter(
                    (locker) => locker.id !== unit.id,
                  );
                } catch (error) {
                  console.log(
                    `Error in canceling reservation: ${error.message}`,
                  );
                }
                oldLockerUnits = oldLockerUnits.filter(
                  (locker) => locker.id !== unit.id,
                );
              }),
            );
          }

          if (item.changeType === "increased") {
            const quantityDifference = item.newAmount - item.oldAmount;
            await assignLockers(item, booking, quantityDifference);
          }
        }
      };

      await cancelLockers(itemsRemoved, oldLockerUnits);
      await Promise.all(
        itemsAdded.map((item) =>
          assignLockers(item, updatedBooking, item.amount),
        ),
      );
      await handleQuantityChanges(
        itemsWithQuantityChanges,
        oldLockerUnits,
        updatedBooking,
      );

      if (changedBookingTime) {
        const filteredUnitsToBeUpdated = oldLockerUnits.filter(
          (unit) =>
            unchangedItems.some(
              (item) => item.bookableId === unit.bookableId,
            ) ||
            itemsWithQuantityChanges.some(
              (item) => item.bookableId === unit.bookableId,
            ),
        );

        await Promise.all(
          filteredUnitsToBeUpdated.map(async (unit) => {
            const updatedLockerInfo = await processLocker(
              unit,
              "update",
              oldBooking.tenantId,
              oldBooking.id,
              updatedBooking.timeBegin,
              updatedBooking.timeEnd,
            );
            if (updatedLockerInfo) {
              updatedBooking.lockerInfo = updatedBooking.lockerInfo.map(
                (locker) =>
                  locker.id === updatedLockerInfo.id
                    ? updatedLockerInfo
                    : locker,
              );
            }
          }),
        );
      }

      const confirmLockers = async (units, booking) => {
        const lockersToConfirm = units.filter(
          (unit) =>
            !unit.isConfirmed &&
            unchangedItems.some((item) => item.bookableId === unit.bookableId),
        );

        await Promise.all(
          lockersToConfirm.map(async (unit) => {
            try {
              const updatedLockerInfo = await processLocker(
                unit,
                "start",
                booking.tenantId,
                booking.id,
                booking.timeBegin,
                booking.timeEnd,
              );
              if (updatedLockerInfo) {
                booking.lockerInfo = booking.lockerInfo.map((locker) =>
                  locker.id === updatedLockerInfo.id
                    ? updatedLockerInfo
                    : locker,
                );
              }
            } catch (error) {
              throw new Error(error);
            }
          }),
        );
      };

      await confirmLockers(oldLockerUnits, updatedBooking);

      await BookingManager.storeBooking(updatedBooking);
    } catch (error) {
      console.log(`Error in updating booking: ${error}`);
      throw new Error(`Error in getting booking: ${error.message}`);
    }
  }

  /**
   * Handles the cancellation of a booking.
   *
   * This method is responsible for cancelling a booking and managing the associated locker units.
   * It retrieves the booking based on the provided bookingId and tenantId, determines the locker units associated with the booking,
   * and performs the necessary actions to cancel these locker units.
   *
   * The method throws an error if the booking is not found.
   *
   * @async
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} bookingId - The ID of the booking.
   * @throws {Error} If the booking is not found.
   */
  async handleCancel(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    const lockerUnitsToBeCanceled = LockerService.assignedLocker(booking);

    if (!lockerUnitsToBeCanceled) {
      return;
    }

    const results = [];

    for (const unit of lockerUnitsToBeCanceled) {
      let locker;
      switch (unit.lockerSystem) {
        case LOCKER_TYPE.PAREVA:
          locker = new ParevaLocker(tenantId, bookingId, unit.id);
          break;
        default:
          throw new Error("Unsupported locker type");
      }
      results.push(await locker.cancelReservation(unit.processId));
    }

    return results;
  }

  /**
   * Reserves a locker for the given tenantId, unitId, lockerSystem, startTime, endTime, and reserveTime.
   * The locker is added to the reservedLockers array.
   * @param {string} tenantId - The ID of the tenant.
   * @param bookableId
   * @param {string} id - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} startTime - The start time for the locker reservation.
   * @param {number} endTime - The end time for the locker reservation.
   * @param {number} [reserveTime=Date.now()] - The time when the locker was reserved.
   */
  static reserveLocker(
    tenantId,
    bookableId,
    id,
    lockerSystem,
    startTime,
    endTime,
    reserveTime = Date.now(),
  ) {
    LockerService.reservedLockers.push({
      tenantId,
      bookableId,
      id,
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
   * @param {string} id - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} startTime - The start time for the locker reservation.
   * @param {number} endTime - The end time for the locker reservation.
   */
  static freeReservedLocker(tenantId, id, lockerSystem, startTime, endTime) {
    LockerService.reservedLockers = LockerService.reservedLockers.filter(
      (locker) => {
        return (
          locker.tenantId !== tenantId &&
          locker.id !== id &&
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
   * @param {string} id - The ID of the locker unit.
   * @param {string} lockerSystem - The locker system.
   * @param {number} timeBegin - The start time for the locker reservation.
   * @param {number} timeEnd - The end time for the locker reservation.
   * @param {number} requiredAmount - The number of possible lockers left.
   * @param {number} unitAmount - The total number of lockers.
   * @returns {boolean} True if the locker is reserved, false otherwise.
   */
  static isLockerReserved(
    tenantId,
    id,
    lockerSystem,
    timeBegin,
    timeEnd,
    requiredAmount,
    unitAmount,
  ) {
    const reservedLockers = LockerService.reservedLockers.filter(
      (locker) =>
        locker.tenantId === tenantId &&
        locker.id === id &&
        locker.lockerSystem === lockerSystem &&
        locker.startTime <= timeBegin &&
        locker.endTime >= timeEnd,
    );
    if (reservedLockers.length > 0) {
      return reservedLockers.length >= unitAmount - requiredAmount;
    } else {
      return false;
    }
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
    return booking.lockerInfo || [];
  }
}

module.exports = LockerService;
