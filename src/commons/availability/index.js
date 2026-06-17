const availabilityRules = require("./availability-rules");
const providers = require("./providers");
const { CHECK_TYPES } = require("./checkout-check-types");
const checkoutAvailabilityChecks = require("./checkout-availability-checks");
const calendarV2ContextChecks = require("./calendar-v2-context-checks");
const {
  checkWindowAvailability,
  getBookingsForCapacityCheck,
} = require("./check-window-availability");

module.exports = {
  ...availabilityRules,
  ...providers,
  ...checkoutAvailabilityChecks,
  ...calendarV2ContextChecks,
  CHECK_TYPES,
  checkWindowAvailability,
  getBookingsForCapacityCheck,
};
