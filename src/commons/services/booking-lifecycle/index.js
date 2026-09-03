/**
 * The booking lifecycle module: the default instance, the factory, the
 * pipeline's error and the vocabulary of states, transitions and triggers.
 */

const {
  createBookingLifecycle,
  bookingLifecycle,
} = require("./booking-lifecycle");
const { LifecycleError } = require("./pipeline");
const { STATUS, TRANSITION, TRIGGER } = require("./booking-state");

module.exports = {
  createBookingLifecycle,
  bookingLifecycle,
  LifecycleError,
  STATUS,
  TRANSITION,
  TRIGGER,
};
