const bookingAmount = require("./booking-amount");
const capacityRules = require("./capacity-rules");
const parentChildRules = require("./parent-child-rules");
const eventRules = require("./event-rules");
const durationRules = require("./duration-rules");
const blockPeriodRules = require("./block-period-rules");
const timePeriodRules = require("./time-period-rules");
const permissionRules = require("./permission-rules");
const maxBookingDateRules = require("./max-booking-date-rules");
const minBookingLeadTimeRules = require("./min-booking-lead-time-rules");
const { CAPACITY_MODES } = require("./types");

module.exports = {
  ...bookingAmount,
  ...capacityRules,
  ...parentChildRules,
  ...eventRules,
  ...durationRules,
  ...blockPeriodRules,
  ...timePeriodRules,
  ...permissionRules,
  ...maxBookingDateRules,
  ...minBookingLeadTimeRules,
  CAPACITY_MODES,
};
