const lockerRegistry = {};

function registerLocker(type, LockerClass) {
  lockerRegistry[type] = LockerClass;
}

function createLocker(type, tenantId, bookingId, unitId) {
  const LockerClass = lockerRegistry[type];
  if (!LockerClass) {
    throw new Error(`Unsupported locker type: ${type}`);
  }
  return new LockerClass(tenantId, bookingId, unitId);
}

function getRegisteredTypes() {
  return Object.keys(lockerRegistry);
}

module.exports = { registerLocker, createLocker, getRegisteredTypes };
