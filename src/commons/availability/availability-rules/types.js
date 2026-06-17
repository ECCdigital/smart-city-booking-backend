/** @typedef {"additive"|"exclusive"} CapacityMode */

/** @typedef {{ timeBegin: number, timeEnd: number, available: boolean }} AvailabilityInterval */

const CAPACITY_MODES = Object.freeze({
  ADDITIVE: "additive",
  EXCLUSIVE: "exclusive",
});

module.exports = {
  CAPACITY_MODES,
};
