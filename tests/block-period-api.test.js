const assert = require("assert");
const sinon = require("sinon");
const BlockPeriodService = require("../src/commons/services/block-period-service");
const CalendarController = require("../src/platform/api/controllers/calendar-controller");
const { BookableManager } = require("../src/commons/data-managers/bookable-manager");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");
const checkWindowAvailabilityModule = require("../src/commons/availability/check-window-availability");
const {
  ManualItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const { generateBlockPeriodInstances } = require("../src/commons/utilities/block-period-generator");
const { BadRequestError, NotFoundError } = require("../src/errors/BaseError");

const weekendPeriod = {
  id: "weekend",
  label: "Wochenende",
  startWeekday: 6,
  startTime: "08:00",
  endWeekday: 0,
  endTime: "20:00",
};

function localDate(isoDate, time = "00:00") {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function blockPeriodBookable(overrides = {}) {
  return {
    id: "camping-a",
    tenantId: "tenant-1",
    title: "Camping A",
    type: "resource",
    isBookable: true,
    isBlockPeriodRelated: true,
    blockPeriods: [weekendPeriod],
    amount: 1,
    priceCategories: [{ priceEur: 50, fixedPrice: true, weekdays: [] }],
    priceType: "per-item",
    permittedUsers: [],
    permittedRoles: [],
    ...overrides,
  };
}

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

describe("BlockPeriodService", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns block periods with availability and price", async () => {
    const bookable = blockPeriodBookable();
    const [instance] = generateBlockPeriodInstances(
      localDate("2026-06-01"),
      localDate("2026-06-30"),
      bookable.blockPeriods,
    );

    sinon.stub(BookableManager, "getBookable").resolves(bookable);
    sinon.stub(AvailabilityContext, "create").resolves({});
    sinon
      .stub(checkWindowAvailabilityModule, "checkWindowAvailability")
      .resolves({ available: true });
    sinon.stub(ManualItemCheckoutService.prototype, "init").resolves();
    sinon
      .stub(ManualItemCheckoutService.prototype, "regularPriceEur")
      .resolves(50);

    const result = await BlockPeriodService.getAvailableBlockPeriods(
      "tenant-1",
      "camping-a",
      "2026-06-01",
      "2026-06-30",
      1,
      "user-1",
    );

    assert.strictEqual(result.title, "Camping A");
    assert.ok(result.blockPeriods.length >= 1);
    assert.strictEqual(result.blockPeriods[0].blockPeriodId, "weekend");
    assert.strictEqual(result.blockPeriods[0].available, true);
    assert.strictEqual(result.blockPeriods[0].priceEur, 50);
    assert.strictEqual(result.blockPeriods[0].timeBegin, instance.timeBegin);
  });

  it("includes reason when a block period is unavailable", async () => {
    const bookable = blockPeriodBookable();

    sinon.stub(BookableManager, "getBookable").resolves(bookable);
    sinon.stub(AvailabilityContext, "create").resolves({});
    sinon
      .stub(checkWindowAvailabilityModule, "checkWindowAvailability")
      .resolves({ available: false, reason: "availability" });

    const result = await BlockPeriodService.getAvailableBlockPeriods(
      "tenant-1",
      "camping-a",
      "2026-06-01",
      "2026-06-30",
      1,
      null,
    );

    assert.strictEqual(result.blockPeriods[0].available, false);
    assert.strictEqual(result.blockPeriods[0].reason, "availability");
    assert.strictEqual(result.blockPeriods[0].priceEur, undefined);
  });

  it("throws when the bookable is not block-period related", async () => {
    sinon.stub(BookableManager, "getBookable").resolves({
      id: "room-a",
      isBlockPeriodRelated: false,
    });

    await assert.rejects(
      () =>
        BlockPeriodService.getAvailableBlockPeriods(
          "tenant-1",
          "room-a",
          "2026-06-01",
          "2026-06-30",
          1,
          null,
        ),
      BadRequestError,
    );
  });

  it("throws when the bookable does not exist", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(null);

    await assert.rejects(
      () =>
        BlockPeriodService.getAvailableBlockPeriods(
          "tenant-1",
          "missing",
          "2026-06-01",
          "2026-06-30",
          1,
          null,
        ),
      NotFoundError,
    );
  });

  it("throws for invalid date range input", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(blockPeriodBookable());

    await assert.rejects(
      () =>
        BlockPeriodService.getAvailableBlockPeriods(
          "tenant-1",
          "camping-a",
          "not-a-date",
          "2026-06-30",
          1,
          null,
        ),
      (error) =>
        error instanceof BadRequestError &&
        error.code === "invalid_date_range",
    );
  });

  it("throws when the date range exceeds the maximum horizon", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(blockPeriodBookable());

    await assert.rejects(
      () =>
        BlockPeriodService.getAvailableBlockPeriods(
          "tenant-1",
          "camping-a",
          "2026-01-01",
          "2026-12-31",
          1,
          null,
        ),
      (error) =>
        error instanceof BadRequestError &&
        error.code === "date_range_too_large",
    );
  });
});

describe("block periods API", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns block periods from the controller", async () => {
    sinon.stub(BlockPeriodService, "getAvailableBlockPeriods").resolves({
      title: "Camping A",
      blockPeriods: [
        {
          blockPeriodId: "weekend",
          label: "Wochenende",
          timeBegin: 1,
          timeEnd: 2,
          available: true,
          priceEur: 50,
        },
      ],
    });

    const response = createMockResponse();
    await CalendarController.getBookableBlockPeriods(
      {
        params: { tenant: "tenant-1", id: "camping-a" },
        query: { amount: 1, startDate: "2026-06-01", endDate: "2026-06-30" },
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.title, "Camping A");
    assert.strictEqual(response.body.blockPeriods.length, 1);
    assert.strictEqual(
      BlockPeriodService.getAvailableBlockPeriods.calledOnce,
      true,
    );
  });

  it("returns 400 for non block-period bookables", async () => {
    sinon
      .stub(BlockPeriodService, "getAvailableBlockPeriods")
      .rejects(new BadRequestError("not_block_period_bookable"));

    const response = createMockResponse();
    await CalendarController.getBookableBlockPeriods(
      {
        params: { tenant: "tenant-1", id: "room-a" },
        query: {},
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.body.code, "not_block_period_bookable");
  });

  it("returns 404 when the bookable is missing", async () => {
    sinon
      .stub(BlockPeriodService, "getAvailableBlockPeriods")
      .rejects(new NotFoundError("bookable_not_found"));

    const response = createMockResponse();
    await CalendarController.getBookableBlockPeriods(
      {
        params: { tenant: "tenant-1", id: "missing" },
        query: {},
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 404);
    assert.strictEqual(response.body.code, "bookable_not_found");
  });

  it("returns 400 for invalid date range input", async () => {
    sinon
      .stub(BlockPeriodService, "getAvailableBlockPeriods")
      .rejects(new BadRequestError("invalid_date_range"));

    const response = createMockResponse();
    await CalendarController.getBookableBlockPeriods(
      {
        params: { tenant: "tenant-1", id: "camping-a" },
        query: { startDate: "not-a-date", endDate: "2026-06-30" },
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.body.code, "invalid_date_range");
  });

  it("returns 400 when the date range is too large", async () => {
    sinon
      .stub(BlockPeriodService, "getAvailableBlockPeriods")
      .rejects(new BadRequestError("date_range_too_large"));

    const response = createMockResponse();
    await CalendarController.getBookableBlockPeriods(
      {
        params: { tenant: "tenant-1", id: "camping-a" },
        query: { startDate: "2026-01-01", endDate: "2026-12-31" },
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.body.code, "date_range_too_large");
  });
});
