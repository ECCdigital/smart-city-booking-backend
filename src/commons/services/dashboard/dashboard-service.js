const { DateTime } = require("luxon");
const TenantManager = require("../../data-managers/tenant-manager");
const UserManager = require("../../data-managers/user-manager");
const PermissionService = require("../permission-service");
const DashboardManager = require("../../data-managers/dashboard-manager");
const { DashboardCache } = require("./dashboard-cache");
const { RolePermission } = require("../../entities/role/role");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");

const DEFAULT_BY_BOOKABLE_LIMIT = 100;
const MAX_BY_BOOKABLE_LIMIT = 500;
const MAX_BY_PERIOD_BUCKETS = 366;
const BERLIN_TZ = "Europe/Berlin";
const GRANULARITIES = new Set(["day", "week", "month", "year"]);

function parseOptionalDateMs(value, fieldName) {
  if (value == null || value === "") {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new BadRequestError(`Invalid ${fieldName} datetime`);
  }
  return ms;
}

function toIsoOrNull(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

function clampByBookableLimit(raw) {
  if (raw == null || raw === "") {
    return DEFAULT_BY_BOOKABLE_LIMIT;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_BY_BOOKABLE_LIMIT;
  }
  return Math.min(n, MAX_BY_BOOKABLE_LIMIT);
}

function parseIsBookable(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  if (raw === true || raw === "true" || raw === "1") {
    return true;
  }
  if (raw === false || raw === "false" || raw === "0") {
    return false;
  }
  throw new BadRequestError("Invalid isBookable value");
}

/**
 * Parse multi-value status (repeated and/or comma-separated).
 * @returns {string[]|null} Canonical order intersection, or null when unset.
 */
function parseStatusKeys(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  const parts = [];
  const list = Array.isArray(raw) ? raw : [raw];
  for (const item of list) {
    if (item == null || item === "") {
      continue;
    }
    for (const piece of String(item).split(",")) {
      const trimmed = piece.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }
  }
  if (!parts.length) {
    return null;
  }

  const seen = new Set();
  for (const key of parts) {
    if (!DashboardManager.isValidStatusKey(key)) {
      throw new BadRequestError("Invalid status filter");
    }
    seen.add(key);
  }
  return DashboardManager.getStatusKeys().filter((key) => seen.has(key));
}

function parseGranularity(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  const value = String(raw).trim();
  if (!GRANULARITIES.has(value)) {
    throw new BadRequestError("Invalid granularity");
  }
  return value;
}

function parseFilters(query = {}, { includeByBookableLimit = false } = {}) {
  const fromMs = parseOptionalDateMs(query.from, "from");
  const toMs = parseOptionalDateMs(query.to, "to");
  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new BadRequestError("`from` must be before or equal to `to`");
  }

  const filters = {
    fromMs,
    toMs,
    bookableId: query.bookableId || null,
    statusKeys: parseStatusKeys(query.status),
    granularity: parseGranularity(query.granularity),
    isBookable: parseIsBookable(query.isBookable),
  };

  if (includeByBookableLimit) {
    filters.byBookableLimit = clampByBookableLimit(query.byBookableLimit);
  }

  return filters;
}

function cacheKey(prefix, userId, filters, extra = {}) {
  return JSON.stringify({ prefix, userId, ...filters, ...extra });
}

function emptyStatusCounts() {
  const counts = {};
  for (const key of DashboardManager.getStatusKeys()) {
    counts[key] = 0;
  }
  return counts;
}

function statusArrayFromCounts(counts) {
  return DashboardManager.getStatusKeys().map((status) => ({
    status,
    count: counts[status] || 0,
  }));
}

function startOfBerlinPeriod(ms, granularity) {
  return DateTime.fromMillis(ms, { zone: BERLIN_TZ }).startOf(granularity);
}

function periodKeyFromDateTime(dt, granularity) {
  switch (granularity) {
    case "day":
      return dt.toFormat("yyyy-MM-dd");
    case "week":
      return dt.toFormat("kkkk-'W'WW");
    case "month":
      return dt.toFormat("yyyy-MM");
    case "year":
      return dt.toFormat("yyyy");
    default:
      throw new BadRequestError("Invalid granularity");
  }
}

function plusOnePeriod(dt, granularity) {
  switch (granularity) {
    case "day":
      return dt.plus({ days: 1 });
    case "week":
      return dt.plus({ weeks: 1 });
    case "month":
      return dt.plus({ months: 1 });
    case "year":
      return dt.plus({ years: 1 });
    default:
      throw new BadRequestError("Invalid granularity");
  }
}

/**
 * Count Berlin periods in the inclusive zero-fill range.
 * Stops counting after MAX_BY_PERIOD_BUCKETS + 1 so callers can reject early.
 */
function countBerlinPeriods(startMs, endMs, granularity) {
  if (startMs > endMs) {
    return 0;
  }
  let cursor = startOfBerlinPeriod(startMs, granularity);
  const end = startOfBerlinPeriod(endMs, granularity);
  let count = 0;
  while (cursor <= end) {
    count += 1;
    if (count > MAX_BY_PERIOD_BUCKETS) {
      return count;
    }
    cursor = plusOnePeriod(cursor, granularity);
  }
  return count;
}

function zeroFillByPeriod(
  { bookings, cancellations, revenue },
  startMs,
  endMs,
  granularity,
) {
  if (startMs > endMs) {
    return [];
  }
  const rows = [];
  let cursor = startOfBerlinPeriod(startMs, granularity);
  const end = startOfBerlinPeriod(endMs, granularity);
  while (cursor <= end) {
    const key = periodKeyFromDateTime(cursor, granularity);
    const revenueEntry = revenue.get(key) || {};
    rows.push({
      period: key,
      bookings: bookings.get(key) || 0,
      cancellations: cancellations.get(key) || 0,
      revenueEur: roundMoney(revenueEntry.revenueEur || 0),
      regularRevenueEur: roundMoney(revenueEntry.regularRevenueEur || 0),
    });
    cursor = plusOnePeriod(cursor, granularity);
  }
  return rows;
}

function effectiveRange(fromMs, toMs, createdAtMs, nowMs = Date.now()) {
  const rangeStart = Math.max(
    fromMs != null ? fromMs : createdAtMs,
    createdAtMs,
  );
  const rangeEnd = toMs != null ? Math.min(toMs, nowMs) : nowMs;
  return { rangeStart, rangeEnd };
}

function assertPeriodCap(rangeStart, rangeEnd, granularity) {
  if (!granularity) {
    return;
  }
  if (rangeStart > rangeEnd) {
    return;
  }
  const count = countBerlinPeriods(rangeStart, rangeEnd, granularity);
  if (count > MAX_BY_PERIOD_BUCKETS) {
    throw new BadRequestError(
      `granularity series exceeds ${MAX_BY_PERIOD_BUCKETS} periods`,
    );
  }
}

async function buildByPeriod(tenantIds, filters, rangeStart, rangeEnd) {
  const { granularity, fromMs, toMs, bookableId, statusKeys } = filters;
  if (!granularity) {
    return [];
  }
  if (rangeStart > rangeEnd) {
    return [];
  }
  assertPeriodCap(rangeStart, rangeEnd, granularity);

  const [bookings, cancellations, revenue] = await Promise.all([
    DashboardManager.aggregateBookingsByPeriod({
      tenantIds,
      fromMs,
      toMs,
      bookableId,
      statusKeys,
      granularity,
    }),
    DashboardManager.aggregateCancellationsByPeriod({
      tenantIds,
      fromMs,
      toMs,
      bookableId,
      statusKeys,
      granularity,
    }),
    DashboardManager.aggregateRevenueByPeriod({
      tenantIds,
      fromMs,
      toMs,
      bookableId,
      granularity,
    }),
  ]);

  return zeroFillByPeriod(
    { bookings, cancellations, revenue },
    rangeStart,
    rangeEnd,
    granularity,
  );
}

function sortByBookableRows(rows) {
  return rows.sort((a, b) => {
    if (b.bookings !== a.bookings) {
      return b.bookings - a.bookings;
    }
    if (b.cancellations !== a.cancellations) {
      return b.cancellations - a.cancellations;
    }
    return String(a.bookableId).localeCompare(String(b.bookableId));
  });
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function revenueTotals(entry) {
  return {
    revenueEur: roundMoney(entry && entry.revenueEur),
    regularRevenueEur: roundMoney(entry && entry.regularRevenueEur),
  };
}

class DashboardService {
  /**
   * Tenants the user may see on the dashboard.
   * Instance owner → all; else tenant owner or manageBookings.readAny.
   */
  static async getAllowedTenants(userId) {
    const isInstanceOwner = await PermissionService._isInstanceOwner(userId);
    const allTenants = await TenantManager.getTenants();

    if (isInstanceOwner) {
      return allTenants;
    }

    const permissions = await UserManager.getUserPermissions(userId);
    const allowedIds = new Set();

    for (const tp of permissions.tenants || []) {
      if (tp.isOwner === true || tp.manageBookings?.readAny === true) {
        allowedIds.add(tp.tenantId);
      }
    }

    return allTenants.filter((t) => allowedIds.has(t.id));
  }

  static async assertTenantAccess(userId, tenantId) {
    const allowed = await PermissionService._allowReadAny(
      userId,
      tenantId,
      RolePermission.MANAGE_BOOKINGS,
    );
    if (!allowed) {
      throw new ForbiddenError("Permission denied");
    }
  }

  static async getInstanceSummary(userId, query) {
    const filters = parseFilters(query);
    const key = cacheKey("instance", userId, filters);
    const cached = DashboardCache.get(key);
    if (cached) {
      return cached;
    }

    const allowedTenants = await DashboardService.getAllowedTenants(userId);
    if (!allowedTenants.length) {
      throw new ForbiddenError("Permission denied");
    }

    const data = await DashboardService._buildInstanceSummary(
      allowedTenants,
      filters,
    );
    DashboardCache.set(key, data);
    return data;
  }

  static async getTenantSummary(userId, tenantId, query) {
    await DashboardService.assertTenantAccess(userId, tenantId);

    const tenant = await TenantManager.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }

    const filters = parseFilters(query, { includeByBookableLimit: true });
    const key = cacheKey("tenant", userId, filters, { tenantId });
    const cached = DashboardCache.get(key);
    if (cached) {
      return cached;
    }

    const data = await DashboardService._buildTenantSummary(tenant, filters);
    DashboardCache.set(key, data);
    return data;
  }

  static async _buildInstanceSummary(tenants, filters) {
    const tenantIds = tenants.map((t) => t.id);
    const { fromMs, toMs, bookableId, statusKeys, isBookable, granularity } =
      filters;

    const createdAtMap =
      await DashboardManager.getTenantCreatedAtMap(tenantIds);
    let earliestCreatedAt = Infinity;
    for (const id of tenantIds) {
      const createdAt = createdAtMap.get(id);
      if (createdAt != null && createdAt < earliestCreatedAt) {
        earliestCreatedAt = createdAt;
      }
    }
    if (!Number.isFinite(earliestCreatedAt)) {
      earliestCreatedAt = 0;
    }
    const { rangeStart, rangeEnd } = effectiveRange(
      fromMs,
      toMs,
      earliestCreatedAt,
    );
    assertPeriodCap(rangeStart, rangeEnd, granularity);

    const [
      users,
      membershipsByTenant,
      bookablesByTenant,
      eventsByTenant,
      activeEventsByTenant,
      bookingsByTenant,
      cancellationsByTenant,
      revenueByTenant,
    ] = await Promise.all([
      DashboardManager.countUsers(),
      DashboardManager.countActiveMembershipsByTenant(tenantIds),
      DashboardManager.countBookablesByTenant(tenantIds, isBookable),
      DashboardManager.countEventsByTenant(tenantIds),
      DashboardManager.countActiveEventsByTenant(tenantIds),
      DashboardManager.aggregateBookingCountsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKeys,
        includeByStatus: false,
      }),
      DashboardManager.aggregateCancellationsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKeys,
      }),
      DashboardManager.aggregateRevenueByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
      }),
    ]);

    const byTenant = tenants.map((tenant) => {
      const stock = bookablesByTenant.get(tenant.id) || {
        bookables: 0,
        bookableObjects: 0,
      };
      const booking = bookingsByTenant.get(tenant.id) || { bookings: 0 };
      const revenue = revenueTotals(revenueByTenant.get(tenant.id));
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        users: membershipsByTenant.get(tenant.id) || 0,
        bookings: booking.bookings || 0,
        cancellations: cancellationsByTenant.get(tenant.id) || 0,
        bookables: stock.bookables,
        bookableObjects: stock.bookableObjects,
        events: eventsByTenant.get(tenant.id) || 0,
        activeEvents: activeEventsByTenant.get(tenant.id) || 0,
        revenueEur: revenue.revenueEur,
        regularRevenueEur: revenue.regularRevenueEur,
      };
    });

    byTenant.sort((a, b) => a.tenantId.localeCompare(b.tenantId));

    const totals = {
      tenants: byTenant.length,
      users,
      bookings: 0,
      cancellations: 0,
      bookables: 0,
      bookableObjects: 0,
      events: 0,
      activeEvents: 0,
      revenueEur: 0,
      regularRevenueEur: 0,
    };

    for (const row of byTenant) {
      totals.bookings += row.bookings;
      totals.cancellations += row.cancellations;
      totals.bookables += row.bookables;
      totals.bookableObjects += row.bookableObjects;
      totals.events += row.events;
      totals.activeEvents += row.activeEvents;
      totals.revenueEur += row.revenueEur;
      totals.regularRevenueEur += row.regularRevenueEur;
    }
    totals.revenueEur = roundMoney(totals.revenueEur);
    totals.regularRevenueEur = roundMoney(totals.regularRevenueEur);

    const byPeriod = await buildByPeriod(
      tenantIds,
      filters,
      rangeStart,
      rangeEnd,
    );

    return {
      from: toIsoOrNull(fromMs),
      to: toIsoOrNull(toMs),
      status: statusKeys,
      granularity,
      totals,
      byPeriod,
      byTenant,
    };
  }

  static async _buildTenantSummary(tenant, filters) {
    const tenantIds = [tenant.id];
    const {
      fromMs,
      toMs,
      bookableId,
      statusKeys,
      isBookable,
      byBookableLimit,
      granularity,
    } = filters;

    const createdAtMap =
      await DashboardManager.getTenantCreatedAtMap(tenantIds);
    const tenantCreatedAt = createdAtMap.get(tenant.id) || 0;
    const { rangeStart, rangeEnd } = effectiveRange(
      fromMs,
      toMs,
      tenantCreatedAt,
    );
    assertPeriodCap(rangeStart, rangeEnd, granularity);

    const [
      membershipsByTenant,
      bookablesByTenant,
      eventsByTenant,
      activeEventsByTenant,
      bookingsByTenant,
      cancellationsByTenant,
      revenueByTenant,
      byBookableRows,
    ] = await Promise.all([
      DashboardManager.countActiveMembershipsByTenant(tenantIds),
      DashboardManager.countBookablesByTenant(tenantIds, isBookable),
      DashboardManager.countEventsByTenant(tenantIds),
      DashboardManager.countActiveEventsByTenant(tenantIds),
      DashboardManager.aggregateBookingCountsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKeys,
        includeByStatus: true,
      }),
      DashboardManager.aggregateCancellationsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKeys,
      }),
      DashboardManager.aggregateRevenueByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
      }),
      DashboardManager.aggregateByBookable({
        tenantId: tenant.id,
        fromMs,
        toMs,
        bookableId,
        statusKeys,
      }),
    ]);

    const stock = bookablesByTenant.get(tenant.id) || {
      bookables: 0,
      bookableObjects: 0,
    };
    const booking = bookingsByTenant.get(tenant.id) || {
      bookings: 0,
      byStatus: emptyStatusCounts(),
    };
    const revenue = revenueTotals(revenueByTenant.get(tenant.id));

    const byPeriod = await buildByPeriod(
      tenantIds,
      filters,
      rangeStart,
      rangeEnd,
    );

    const sorted = sortByBookableRows(byBookableRows);
    const byBookable = sorted.slice(0, byBookableLimit);
    const byBookableHasMore = sorted.length > byBookableLimit;

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      from: toIsoOrNull(fromMs),
      to: toIsoOrNull(toMs),
      status: statusKeys,
      granularity,
      totals: {
        users: membershipsByTenant.get(tenant.id) || 0,
        bookings: booking.bookings || 0,
        cancellations: cancellationsByTenant.get(tenant.id) || 0,
        bookables: stock.bookables,
        bookableObjects: stock.bookableObjects,
        events: eventsByTenant.get(tenant.id) || 0,
        activeEvents: activeEventsByTenant.get(tenant.id) || 0,
        revenueEur: revenue.revenueEur,
        regularRevenueEur: revenue.regularRevenueEur,
      },
      byStatus: statusArrayFromCounts(booking.byStatus || emptyStatusCounts()),
      byPeriod,
      byBookable,
      byBookableHasMore,
      byBookableLimit,
    };
  }
}

module.exports = DashboardService;
module.exports.DEFAULT_BY_BOOKABLE_LIMIT = DEFAULT_BY_BOOKABLE_LIMIT;
module.exports.MAX_BY_BOOKABLE_LIMIT = MAX_BY_BOOKABLE_LIMIT;
module.exports.MAX_BY_PERIOD_BUCKETS = MAX_BY_PERIOD_BUCKETS;
module.exports.parseFilters = parseFilters;
module.exports.clampByBookableLimit = clampByBookableLimit;
module.exports.countBerlinPeriods = countBerlinPeriods;
module.exports.zeroFillByPeriod = zeroFillByPeriod;
module.exports.sortByBookableRows = sortByBookableRows;
