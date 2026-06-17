const bookingAmount = require("./booking-amount");
const capacityRules = require("./capacity-rules");
const parentChildRules = require("./parent-child-rules");
const eventRules = require("./event-rules");
const durationRules = require("./duration-rules");
const permissionRules = require("./permission-rules");
const maxBookingDateRules = require("./max-booking-date-rules");
const { CAPACITY_MODES } = require("./types");

module.exports = {
  ...bookingAmount,
  ...capacityRules,
  ...parentChildRules,
  ...eventRules,
  ...durationRules,
  ...permissionRules,
  ...maxBookingDateRules,
  CAPACITY_MODES,
};
