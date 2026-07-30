const { expect } = require("chai");
const Formatters = require("../src/commons/utilities/formatters");

describe("Formatters.formatBookingPeriod", () => {
  // 2026-07-09 05:15–08:00 Europe/Berlin (CEST, UTC+2)
  const timeBegin = Date.UTC(2026, 6, 9, 3, 15, 0);
  const timeEnd = Date.UTC(2026, 6, 9, 6, 0, 0);

  function normalizeSpaces(value) {
    return String(value).replace(/[\u00a0\u202f]/g, " ");
  }

  it("exposes the allowed mail booking period formats", () => {
    expect(Formatters.MAIL_BOOKING_PERIOD_FORMATS).to.deep.equal([
      "default",
      "fromTo",
      "timeFirst",
      "long",
      "compact",
    ]);
  });

  it("returns an empty string when begin or end is missing", () => {
    expect(Formatters.formatBookingPeriod(null, timeEnd, "default")).to.equal(
      "",
    );
    expect(Formatters.formatBookingPeriod(timeBegin, null, "default")).to.equal(
      "",
    );
    expect(Formatters.formatBookingPeriod(undefined, undefined)).to.equal("");
  });

  it("formats default like the previous email helper output", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "default"),
      ),
    ).to.equal("09.07.2026, 05:15 - 09.07.2026, 08:00");
  });

  it("formats fromTo with von/bis wording", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "fromTo"),
      ),
    ).to.equal("von 05:15 Uhr am 09.07.2026 bis 08:00 Uhr am 09.07.2026");
  });

  it("formats timeFirst with time before date", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "timeFirst"),
      ),
    ).to.equal("05:15 Uhr, 09.07.2026 - 08:00 Uhr, 09.07.2026");
  });

  it("formats long with weekday and month name", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "long"),
      ),
    ).to.equal(
      "Donnerstag, 9. Juli 2026, 05:15 Uhr - Donnerstag, 9. Juli 2026, 08:00 Uhr",
    );
  });

  it("formats compact with two-digit year", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "compact"),
      ),
    ).to.equal("09.07.26, 05:15 - 09.07.26, 08:00");
  });

  it("falls back to default for unknown presets", () => {
    expect(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "unknown"),
      ),
    ).to.equal(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "default"),
      ),
    );
  });

  it("defaults to the default preset when format is omitted", () => {
    expect(
      normalizeSpaces(Formatters.formatBookingPeriod(timeBegin, timeEnd)),
    ).to.equal(
      normalizeSpaces(
        Formatters.formatBookingPeriod(timeBegin, timeEnd, "default"),
      ),
    );
  });
});
