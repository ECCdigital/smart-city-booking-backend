const Holidays = require("date-holidays");

class HolidaysService {
  constructor({ countryCode, stateCode }) {
    this.holidays = new Holidays(countryCode, stateCode);
  }

  getHolidays(year) {
    const holidays = this.holidays.getHolidays(year);
    return holidays.map((holiday) => ({
      date: holiday.date,
      name: holiday.name,
      type: holiday.type,
    }));
  }
}

module.exports = HolidaysService;
