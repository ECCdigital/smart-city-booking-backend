const assert = require("assert");
const sinon = require("sinon");
const { DateTime } = require("luxon");
const DashboardService = require("../src/commons/services/dashboard/dashboard-service");
const DashboardManager = require("../src/commons/data-managers/dashboard-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const PermissionService = require("../src/commons/services/permission-service");
const {
  DashboardCache,
} = require("../src/commons/services/dashboard/dashboard-cache");
const {
  BOOKING_STATUS_I18N,
} = require("../src/commons/services/booking/booking-status-keys");
const { BadRequestError, ForbiddenError } = require("../src/errors/BaseError");

function stubEmptyPeriodAggs(sandbox) {
  sandbox
    .stub(DashboardManager, "aggregateBookingsByPeriod")
    .resolves(new Map());
  sandbox
    .stub(DashboardManager, "aggregateCancellationsByPeriod")
    .resolves(new Map());
  sandbox
    .stub(DashboardManager, "aggregateRevenueByPeriod")
    .resolves(new Map());
}

describe("DashboardService helpers", function () {
  it("clamps byBookableLimit to default and max", function () {
    assert.strictEqual(DashboardService.clampByBookableLimit(undefined), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("0"), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("abc"), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("250"), 250);
    assert.strictEqual(DashboardService.clampByBookableLimit("999"), 500);
  });

  it("parses filters including multi-status and granularity", function () {
    const ok = DashboardService.parseFilters({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
      status: [
        BOOKING_STATUS_I18N.REJECTED,
        `${BOOKING_STATUS_I18N.PAID_COMPLETED},${BOOKING_STATUS_I18N.REJECTED}`,
      ],
      granularity: "month",
      isBookable: "true",
    });
    assert.strictEqual(ok.fromMs, Date.parse("2026-01-01T00:00:00.000Z"));
    assert.deepStrictEqual(ok.statusKeys, [
      BOOKING_STATUS_I18N.PAID_COMPLETED,
      BOOKING_STATUS_I18N.REJECTED,
    ]);
    assert.strictEqual(ok.granularity, "month");
    assert.strictEqual(ok.isBookable, true);

    assert.strictEqual(DashboardService.parseFilters({}).statusKeys, null);
    assert.strictEqual(DashboardService.parseFilters({}).granularity, null);

    assert.throws(
      () => DashboardService.parseFilters({ status: "nope" }),
      BadRequestError,
    );
    assert.throws(
      () => DashboardService.parseFilters({ granularity: "hour" }),
      BadRequestError,
    );
    assert.throws(
      () => DashboardService.parseFilters({ from: "not-a-date" }),
      BadRequestError,
    );
  });

  it("zero-fills byPeriod in Europe/Berlin and counts buckets", function () {
    const bookings = new Map([["2026-02", 4]]);
    const cancellations = new Map([["2026-01", 1]]);
    const revenue = new Map([["2026-02", 12.5]]);
    const rows = DashboardService.zeroFillByPeriod(
      { bookings, cancellations, revenue },
      Date.parse("2026-01-15T00:00:00.000Z"),
      Date.parse("2026-03-10T00:00:00.000Z"),
      "month",
    );
    assert.deepStrictEqual(rows, [
      { period: "2026-01", bookings: 0, cancellations: 1, revenueEur: 0 },
      { period: "2026-02", bookings: 4, cancellations: 0, revenueEur: 12.5 },
      { period: "2026-03", bookings: 0, cancellations: 0, revenueEur: 0 },
    ]);

    // Midday UTC stays on the same Europe/Berlin calendar day.
    assert.strictEqual(
      DashboardService.countBerlinPeriods(
        Date.parse("2026-01-01T12:00:00.000Z"),
        Date.parse("2026-01-31T12:00:00.000Z"),
        "day",
      ),
      31,
    );

    const weekKey = DateTime.fromISO("2026-02-02", {
      zone: "Europe/Berlin",
    }).toFormat("kkkk-'W'WW");
    assert.strictEqual(weekKey, "2026-W06");
  });

  it("sorts byBookable by bookings, cancellations, then id", function () {
    const sorted = DashboardService.sortByBookableRows([
      { bookableId: "b", bookings: 1, cancellations: 2 },
      { bookableId: "a", bookings: 2, cancellations: 0 },
      { bookableId: "c", bookings: 1, cancellations: 2 },
    ]);
    assert.deepStrictEqual(
      sorted.map((r) => r.bookableId),
      ["a", "b", "c"],
    );
  });
});

describe("DashboardService summaries", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    DashboardCache.invalidateAll();
  });

  afterEach(function () {
    sandbox.restore();
    DashboardCache.invalidateAll();
  });

  it("builds instance summary across allowed tenants", async function () {
    sandbox.stub(PermissionService, "_isInstanceOwner").resolves(true);
    sandbox.stub(TenantManager, "getTenants").resolves([
      { id: "demo", name: "Demo Stadt" },
      { id: "nord", name: "Nordstadt" },
    ]);
    sandbox.stub(DashboardManager, "countUsers").resolves(120);
    sandbox.stub(DashboardManager, "countActiveMembershipsByTenant").resolves(
      new Map([
        ["demo", 42],
        ["nord", 18],
      ]),
    );
    sandbox.stub(DashboardManager, "countBookablesByTenant").resolves(
      new Map([
        ["demo", { bookables: 28, bookableObjects: 22 }],
        ["nord", { bookables: 12, bookableObjects: 10 }],
      ]),
    );
    sandbox.stub(DashboardManager, "countEventsByTenant").resolves(
      new Map([
        ["demo", 5],
        ["nord", 3],
      ]),
    );
    sandbox.stub(DashboardManager, "countActiveEventsByTenant").resolves(
      new Map([
        ["demo", 2],
        ["nord", 1],
      ]),
    );
    sandbox.stub(DashboardManager, "aggregateBookingCountsByTenant").resolves(
      new Map([
        ["demo", { bookings: 310 }],
        ["nord", { bookings: 140 }],
      ]),
    );
    sandbox.stub(DashboardManager, "aggregateCancellationsByTenant").resolves(
      new Map([
        ["demo", 12],
        ["nord", 18],
      ]),
    );
    sandbox.stub(DashboardManager, "aggregateRevenueByTenant").resolves(
      new Map([
        ["demo", { revenueEur: 18450.5 }],
        ["nord", { revenueEur: 3650 }],
      ]),
    );
    sandbox.stub(DashboardManager, "getTenantCreatedAtMap").resolves(
      new Map([
        ["demo", Date.parse("2026-01-01T00:00:00.000Z")],
        ["nord", Date.parse("2026-01-01T00:00:00.000Z")],
      ]),
    );
    stubEmptyPeriodAggs(sandbox);

    const data = await DashboardService.getInstanceSummary("owner-1", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T12:00:00.000Z",
      status: `${BOOKING_STATUS_I18N.PAID_COMPLETED},${BOOKING_STATUS_I18N.REJECTED}`,
      granularity: "month",
    });

    assert.strictEqual(data.totals.tenants, 2);
    assert.strictEqual(data.totals.users, 120);
    assert.strictEqual(data.totals.bookings, 450);
    assert.strictEqual(data.totals.cancellations, 30);
    assert.strictEqual(data.totals.activeEvents, 3);
    assert.strictEqual(data.totals.revenueEur, 22100.5);
    assert.strictEqual(data.byTenant.length, 2);
    assert.strictEqual(data.byTenant[0].tenantId, "demo");
    assert.strictEqual(data.byTenant[0].activeEvents, 2);
    assert.strictEqual(data.from, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(data.to, "2026-06-30T12:00:00.000Z");
    assert.deepStrictEqual(data.status, [
      BOOKING_STATUS_I18N.PAID_COMPLETED,
      BOOKING_STATUS_I18N.REJECTED,
    ]);
    assert.strictEqual(data.granularity, "month");
    assert.strictEqual(data.byPeriod.length, 6);
    assert.strictEqual(data.byPeriod[0].period, "2026-01");
    assert.ok(!Object.prototype.hasOwnProperty.call(data, "revenueByMonth"));
  });

  it("denies instance summary when user has no allowed tenants", async function () {
    sandbox.stub(PermissionService, "_isInstanceOwner").resolves(false);
    sandbox.stub(UserManager, "getUserPermissions").resolves({ tenants: [] });
    sandbox
      .stub(TenantManager, "getTenants")
      .resolves([{ id: "demo", name: "Demo" }]);

    await assert.rejects(
      () => DashboardService.getInstanceSummary("user-1", {}),
      ForbiddenError,
    );
  });

  it("builds tenant summary with byStatus, byPeriod, byBookable cap", async function () {
    sandbox.stub(PermissionService, "_allowReadAny").resolves(true);
    sandbox
      .stub(TenantManager, "getTenant")
      .resolves({ id: "demo", name: "Demo Stadt" });
    sandbox
      .stub(DashboardManager, "countActiveMembershipsByTenant")
      .resolves(new Map([["demo", 42]]));
    sandbox
      .stub(DashboardManager, "countBookablesByTenant")
      .resolves(new Map([["demo", { bookables: 28, bookableObjects: 22 }]]));
    sandbox
      .stub(DashboardManager, "countEventsByTenant")
      .resolves(new Map([["demo", 5]]));
    sandbox
      .stub(DashboardManager, "countActiveEventsByTenant")
      .resolves(new Map([["demo", 3]]));
    sandbox.stub(DashboardManager, "aggregateBookingCountsByTenant").resolves(
      new Map([
        [
          "demo",
          {
            bookings: 310,
            byStatus: {
              [BOOKING_STATUS_I18N.AWAITING_APPROVAL]: 40,
              [BOOKING_STATUS_I18N.PAYMENT_EXPECTED]: 25,
              [BOOKING_STATUS_I18N.PAID_COMPLETED]: 180,
              [BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT]: 53,
              [BOOKING_STATUS_I18N.REJECTED]: 12,
            },
          },
        ],
      ]),
    );
    sandbox
      .stub(DashboardManager, "aggregateCancellationsByTenant")
      .resolves(new Map([["demo", 12]]));
    sandbox
      .stub(DashboardManager, "aggregateRevenueByTenant")
      .resolves(new Map([["demo", { revenueEur: 18450.5 }]]));
    sandbox.stub(DashboardManager, "aggregateByBookable").resolves([
      {
        bookableId: "room-a",
        bookableTitle: "Raum A",
        bookableDeleted: false,
        bookings: 48,
        cancellations: 3,
      },
      {
        bookableId: "room-b",
        bookableTitle: "Raum B",
        bookableDeleted: false,
        bookings: 10,
        cancellations: 0,
      },
    ]);
    sandbox
      .stub(DashboardManager, "getTenantCreatedAtMap")
      .resolves(new Map([["demo", Date.parse("2026-01-01T00:00:00.000Z")]]));
    sandbox.stub(DashboardManager, "aggregateBookingsByPeriod").resolves(
      new Map([
        ["2026-01", 100],
        ["2026-02", 210],
      ]),
    );
    sandbox
      .stub(DashboardManager, "aggregateCancellationsByPeriod")
      .resolves(new Map([["2026-01", 4]]));
    sandbox.stub(DashboardManager, "aggregateRevenueByPeriod").resolves(
      new Map([
        ["2026-01", 2100],
        ["2026-02", 3450.5],
      ]),
    );

    const data = await DashboardService.getTenantSummary("admin-1", "demo", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-28T12:00:00.000Z",
      byBookableLimit: "1",
      granularity: "month",
    });

    assert.strictEqual(data.tenantId, "demo");
    assert.strictEqual(data.totals.bookings, 310);
    assert.strictEqual(data.totals.activeEvents, 3);
    assert.strictEqual(data.byStatus.length, 5);
    assert.strictEqual(
      data.byStatus[0].status,
      BOOKING_STATUS_I18N.AWAITING_APPROVAL,
    );
    assert.strictEqual(data.status, null);
    assert.strictEqual(data.granularity, "month");
    assert.strictEqual(data.byPeriod.length, 2);
    assert.strictEqual(data.byPeriod[0].period, "2026-01");
    assert.strictEqual(data.byPeriod[0].bookings, 100);
    assert.strictEqual(data.byPeriod[0].revenueEur, 2100);
    assert.strictEqual(data.byBookable.length, 1);
    assert.strictEqual(data.byBookable[0].bookableId, "room-a");
    assert.strictEqual(data.byBookableHasMore, true);
    assert.strictEqual(data.byBookableLimit, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(data, "revenueByMonth"));
  });

  it("returns empty byPeriod when granularity is omitted", async function () {
    sandbox.stub(PermissionService, "_allowReadAny").resolves(true);
    sandbox
      .stub(TenantManager, "getTenant")
      .resolves({ id: "demo", name: "Demo" });
    sandbox
      .stub(DashboardManager, "countActiveMembershipsByTenant")
      .resolves(new Map([["demo", 1]]));
    sandbox
      .stub(DashboardManager, "countBookablesByTenant")
      .resolves(new Map([["demo", { bookables: 1, bookableObjects: 1 }]]));
    sandbox
      .stub(DashboardManager, "countEventsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "countActiveEventsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "aggregateBookingCountsByTenant")
      .resolves(new Map([["demo", { bookings: 0, byStatus: {} }]]));
    sandbox
      .stub(DashboardManager, "aggregateCancellationsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "aggregateRevenueByTenant")
      .resolves(new Map([["demo", { revenueEur: 0 }]]));
    sandbox.stub(DashboardManager, "aggregateByBookable").resolves([]);
    sandbox
      .stub(DashboardManager, "getTenantCreatedAtMap")
      .resolves(new Map([["demo", Date.parse("2026-01-01T00:00:00.000Z")]]));
    const bookingsPeriod = sandbox.stub(
      DashboardManager,
      "aggregateBookingsByPeriod",
    );

    const data = await DashboardService.getTenantSummary("admin-1", "demo", {});
    assert.strictEqual(data.granularity, null);
    assert.deepStrictEqual(data.byPeriod, []);
    assert.strictEqual(bookingsPeriod.callCount, 0);
  });

  it("rejects when byPeriod would exceed 366 buckets", async function () {
    sandbox.stub(PermissionService, "_allowReadAny").resolves(true);
    sandbox
      .stub(TenantManager, "getTenant")
      .resolves({ id: "demo", name: "Demo" });
    sandbox
      .stub(DashboardManager, "getTenantCreatedAtMap")
      .resolves(new Map([["demo", Date.parse("2020-01-01T00:00:00.000Z")]]));

    await assert.rejects(
      () =>
        DashboardService.getTenantSummary("admin-1", "demo", {
          from: "2024-01-01T00:00:00.000Z",
          to: "2026-01-15T00:00:00.000Z",
          granularity: "day",
        }),
      BadRequestError,
    );
  });

  it("serves cached instance summary on second call", async function () {
    sandbox.stub(PermissionService, "_isInstanceOwner").resolves(true);
    sandbox
      .stub(TenantManager, "getTenants")
      .resolves([{ id: "demo", name: "Demo" }]);
    sandbox.stub(DashboardManager, "countUsers").resolves(1);
    sandbox
      .stub(DashboardManager, "countActiveMembershipsByTenant")
      .resolves(new Map([["demo", 1]]));
    sandbox
      .stub(DashboardManager, "countBookablesByTenant")
      .resolves(new Map([["demo", { bookables: 1, bookableObjects: 1 }]]));
    sandbox
      .stub(DashboardManager, "countEventsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "countActiveEventsByTenant")
      .resolves(new Map([["demo", 0]]));
    const bookingsStub = sandbox
      .stub(DashboardManager, "aggregateBookingCountsByTenant")
      .resolves(new Map([["demo", { bookings: 5 }]]));
    sandbox
      .stub(DashboardManager, "aggregateCancellationsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "aggregateRevenueByTenant")
      .resolves(new Map([["demo", { revenueEur: 0 }]]));
    sandbox
      .stub(DashboardManager, "getTenantCreatedAtMap")
      .resolves(new Map([["demo", Date.parse("2026-01-01T00:00:00.000Z")]]));
    stubEmptyPeriodAggs(sandbox);

    await DashboardService.getInstanceSummary("owner-1", {});
    await DashboardService.getInstanceSummary("owner-1", {});
    assert.strictEqual(bookingsStub.callCount, 1);
  });
});
