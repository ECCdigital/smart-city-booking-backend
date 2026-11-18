const assert = require("assert");
const {
  formatDate,
  formatDateTime,
} = require("../src/commons/pdf-service/pdf-formatters");

describe("the dates of a PDF document", function () {
  const original = process.env.TZ;

  beforeEach(function () {
    process.env.TZ = "UTC";
  });

  afterEach(function () {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  });

  it("reads the day in Berlin, like the date with time, on a server in UTC", function () {
    // 00:30 on 1 July in Berlin is still 30 June in UTC.
    const justAfterMidnightInBerlin = Date.UTC(2026, 5, 30, 22, 30);

    assert.strictEqual(
      formatDateTime(justAfterMidnightInBerlin),
      "01.07.2026, 00:30",
    );
    assert.strictEqual(formatDate(justAfterMidnightInBerlin), "01.07.2026");
  });
});
