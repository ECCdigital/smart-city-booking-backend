const {getBookable} = require("../../data-managers/bookable-manager");
const {getTenantAppByType} = require("../../data-managers/tenant-manager");
const {getConcurrentBookings, getBooking} = require("../../data-managers/booking-manager");
const {ParevaLocker, LockyLocker} = require("./locker");

const APP_TYPE = "locker";

const LOCKER_TYPE = {
    PAREVA: "pareva",
    LOCKY: "locky",
}

class LockerService {
    static async getAvailableLocker(bookableId, tenantId, timeBegin, timeEnd, amount) {
        try {
            const bookable = await getBookable(bookableId, tenantId);
            if (!bookable) {
                throw new Error("Bookable resource not found");
            }

            const lockerApps = await getTenantAppByType(tenantId, APP_TYPE);
            const bookableLockerDetails = bookable.lockerDetails;
            const activeLockerApps = LockerService.getActiveLockerApps(lockerApps);

            if( bookableLockerDetails.active && activeLockerApps.length > 0) {
                let occupiedUnits = [];
                const possibleUnits = bookableLockerDetails.units;
                const concurrentBookings = await getConcurrentBookings(bookableId, tenantId, timeBegin, timeEnd);

                if (concurrentBookings.length > 0) {
                    occupiedUnits = concurrentBookings
                        .filter((booking) => booking.lockerInfo)
                        .map((booking) => booking.lockerInfo).flat();
                }

                const activeLockerAppIds = activeLockerApps.map(app => app.id);
                const availableUnits = possibleUnits.filter((unit) => {
                    const isOccupied = occupiedUnits.some(
                        (occupiedUnit) => occupiedUnit.id === unit.id && occupiedUnit.lockingSystem === unit.lockingSystem
                    );
                    return !isOccupied && activeLockerAppIds.includes(unit.lockingSystem);
                });

                if (availableUnits.length < amount) {
                    throw new Error("Not enough lockers available");
                }
                return availableUnits.slice(0, amount);
            } else {
                return [];
            }
        } catch (error) {
            throw new Error(`Error in getting available lockers: ${error.message}`);
        }
    }

    static async handleCreate(tenantId, bookingId) {
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
                let locker
                switch (unit.lockingSystem) {
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
            }

        } catch (error) {
            throw new Error(`Error in getting booking: ${error.message}`);
        }
    }

    static async handleUpdate(bookingId, tenantId) {

    }

    static async handleCancel(bookingId, tenantId) {

    }

    static getActiveLockerApps(lockerApps) {
        return lockerApps.filter((app) => app.active);
    }

    static assignedLocker(booking) {
        return booking.lockerInfo
    }
}

module.exports = LockerService;