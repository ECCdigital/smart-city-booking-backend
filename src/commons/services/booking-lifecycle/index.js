/**
 * The booking lifecycle module: the default instances and factories of the
 * single and the group lifecycle, the pipeline's error and the vocabulary
 * of states, transitions and triggers.
 */

const {
  createBookingLifecycle,
  bookingLifecycle,
} = require("./booking-lifecycle");
const {
  createGroupBookingLifecycle,
  groupBookingLifecycle,
} = require("./group-booking-lifecycle");
const { LifecycleError } = require("./pipeline");
const { STATUS, TRANSITION, TRIGGER } = require("./booking-state");

module.exports = {
  createBookingLifecycle,
  bookingLifecycle,
  createGroupBookingLifecycle,
  groupBookingLifecycle,
  LifecycleError,
  STATUS,
  TRANSITION,
  TRIGGER,
};
