const HolidaysService = require("../../../commons/services/holiday/holidays-service");

class HolidayController {
  static async getHolidays(req, res) {
    const { countryCode, stateCode, year } = req.query;

    const hs = new HolidaysService({
      countryCode: countryCode || "DE",
      stateCode,
    });
    const holidays = hs.getHolidays(year);

    return res.json(holidays);
  }
}

module.exports = HolidayController;
