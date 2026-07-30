const assert = require("assert");
const sinon = require("sinon");
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

describe("DashboardService helpers", function () {
  it("clamps byBookableLimit to default and max", function () {
    assert.strictEqual(DashboardService.clampByBookableLimit(undefined), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("0"), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("abc"), 100);
    assert.strictEqual(DashboardService.clampByBookableLimit("250"), 250);
    assert.strictEqual(DashboardService.clampByBookableLimit("999"), 500);
  });

  it("parses filters and rejects invalid status/from", function () {
    const ok = DashboardService.parseFilters({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
      status: BOOKING_STATUS_I18N.REJECTED,
      isBookable: "true",
    });
    assert.strictEqual(ok.fromMs, Date.parse("2026-01-01T00:00:00.000Z"));
    assert.strictEqual(ok.statusKey, BOOKING_STATUS_I18N.REJECTED);
    assert.strictEqual(ok.isBookable, true);

    assert.throws(
      () => DashboardService.parseFilters({ status: "nope" }),
      BadRequestError,
    );
    assert.throws(
      () => DashboardService.parseFilters({ from: "not-a-date" }),
      BadRequestError,
    );
  });

  it("zero-fills revenue months in UTC", function () {
    const months = new Map([["2026-02", 12.5]]);
    const rows = DashboardService.zeroFillRevenueByMonth(
      months,
      Date.parse("2026-01-15T00:00:00.000Z"),
      Date.parse("2026-03-10T00:00:00.000Z"),
    );
    assert.deepStrictEqual(rows, [
      { month: "2026-01", revenueEur: 0 },
      { month: "2026-02", revenueEur: 12.5 },
      { month: "2026-03", revenueEur: 0 },
    ]);
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
        ["demo", { revenueEur: 18450.5, months: new Map() }],
        ["nord", { revenueEur: 3650, months: new Map() }],
      ]),
    );

    const data = await DashboardService.getInstanceSummary("owner-1", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });

    assert.strictEqual(data.totals.tenants, 2);
    assert.strictEqual(data.totals.users, 120);
    assert.strictEqual(data.totals.bookings, 450);
    assert.strictEqual(data.totals.cancellations, 30);
    assert.strictEqual(data.totals.revenueEur, 22100.5);
    assert.strictEqual(data.byTenant.length, 2);
    assert.strictEqual(data.byTenant[0].tenantId, "demo");
    assert.strictEqual(data.from, "2026-01-01T00:00:00.000Z");
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

  it("builds tenant summary with byStatus, revenueByMonth, byBookable cap", async function () {
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
    sandbox.stub(DashboardManager, "aggregateRevenueByTenant").resolves(
      new Map([
        [
          "demo",
          {
            revenueEur: 18450.5,
            months: new Map([
              ["2026-01", 2100],
              ["2026-02", 3450.5],
            ]),
          },
        ],
      ]),
    );
    sandbox.stub(DashboardManager, "aggregateByBookable").resolves([
      {
        bookableId: "room-a",
        bookableTitle: "Raum A",
        bookings: 48,
        cancellations: 3,
      },
      {
        bookableId: "room-b",
        bookableTitle: "Raum B",
        bookings: 10,
        cancellations: 0,
      },
    ]);
    sandbox
      .stub(DashboardManager, "getTenantCreatedAtMap")
      .resolves(new Map([["demo", Date.parse("2026-01-01T00:00:00.000Z")]]));

    const data = await DashboardService.getTenantSummary("admin-1", "demo", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-28T23:59:59.999Z",
      byBookableLimit: "1",
    });

    assert.strictEqual(data.tenantId, "demo");
    assert.strictEqual(data.totals.bookings, 310);
    assert.strictEqual(data.byStatus.length, 5);
    assert.strictEqual(
      data.byStatus[0].status,
      BOOKING_STATUS_I18N.AWAITING_APPROVAL,
    );
    assert.strictEqual(data.revenueByMonth.length, 2);
    assert.strictEqual(data.revenueByMonth[0].month, "2026-01");
    assert.strictEqual(data.byBookable.length, 1);
    assert.strictEqual(data.byBookable[0].bookableId, "room-a");
    assert.strictEqual(data.byBookableHasMore, true);
    assert.strictEqual(data.byBookableLimit, 1);
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
    const bookingsStub = sandbox
      .stub(DashboardManager, "aggregateBookingCountsByTenant")
      .resolves(new Map([["demo", { bookings: 5 }]]));
    sandbox
      .stub(DashboardManager, "aggregateCancellationsByTenant")
      .resolves(new Map([["demo", 0]]));
    sandbox
      .stub(DashboardManager, "aggregateRevenueByTenant")
      .resolves(new Map([["demo", { revenueEur: 0, months: new Map() }]]));

    await DashboardService.getInstanceSummary("owner-1", {});
    await DashboardService.getInstanceSummary("owner-1", {});
    assert.strictEqual(bookingsStub.callCount, 1);
  });
});
