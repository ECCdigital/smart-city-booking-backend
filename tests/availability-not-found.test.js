const assert = require("assert");
const sinon = require("sinon");
const { NotFoundError } = require("../src/errors/BaseError");
const CalendarService = require("../src/commons/services/calendar-service");
const CalendarServiceV2 = require("../src/commons/services/calendar-service-v2");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");

describe("availability not-found handling", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("V1 throws NotFoundError when bookable does not exist", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(null);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);

    await assert.rejects(
      () =>
        CalendarService.checkAvailability(
          "tenant-1",
          "missing-bookable",
          "2026-06-17",
          "2026-06-24",
          1,
          null,
        ),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.strictEqual(error.code, "bookable_not_found");
        return true;
      },
    );
  });

  it("V2 throws NotFoundError when bookable does not exist", async () => {
    sinon.stub(AvailabilityContext, "create").resolves({
      bookable: null,
      parentBookables: [],
      relatedBookables: [],
      tenant: null,
      metrics: { dbQueryCount: 0, segmentChecks: 0 },
    });

    await assert.rejects(
      () =>
        CalendarServiceV2.checkAvailability(
          "tenant-1",
          "missing-bookable",
          "2026-06-17",
          "2026-06-24",
          1,
          null,
        ),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.strictEqual(error.code, "bookable_not_found");
        return true;
      },
    );
  });
});
