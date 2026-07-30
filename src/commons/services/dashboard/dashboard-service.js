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

function parseFilters(query = {}, { includeByBookableLimit = false } = {}) {
  const fromMs = parseOptionalDateMs(query.from, "from");
  const toMs = parseOptionalDateMs(query.to, "to");
  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new BadRequestError("`from` must be before or equal to `to`");
  }

  const statusKey = query.status || null;
  if (statusKey && !DashboardManager.isValidStatusKey(statusKey)) {
    throw new BadRequestError("Invalid status filter");
  }

  const filters = {
    fromMs,
    toMs,
    bookableId: query.bookableId || null,
    statusKey,
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

function monthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function zeroFillRevenueByMonth(monthMap, startMs, endMs) {
  const start = new Date(startMs);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(endMs);
  end.setUTCDate(1);
  end.setUTCHours(0, 0, 0, 0);

  const rows = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = monthKey(cursor);
    rows.push({
      month: key,
      revenueEur: monthMap.get(key) || 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return rows;
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
    const { fromMs, toMs, bookableId, statusKey, isBookable } = filters;

    const [
      users,
      membershipsByTenant,
      bookablesByTenant,
      eventsByTenant,
      bookingsByTenant,
      cancellationsByTenant,
      revenueByTenant,
    ] = await Promise.all([
      DashboardManager.countUsers(),
      DashboardManager.countActiveMembershipsByTenant(tenantIds),
      DashboardManager.countBookablesByTenant(tenantIds, isBookable),
      DashboardManager.countEventsByTenant(tenantIds),
      DashboardManager.aggregateBookingCountsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKey,
        includeByStatus: false,
      }),
      DashboardManager.aggregateCancellationsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKey,
      }),
      DashboardManager.aggregateRevenueByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        byMonth: false,
      }),
    ]);

    const byTenant = tenants.map((tenant) => {
      const stock = bookablesByTenant.get(tenant.id) || {
        bookables: 0,
        bookableObjects: 0,
      };
      const booking = bookingsByTenant.get(tenant.id) || { bookings: 0 };
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        users: membershipsByTenant.get(tenant.id) || 0,
        bookings: booking.bookings || 0,
        cancellations: cancellationsByTenant.get(tenant.id) || 0,
        bookables: stock.bookables,
        bookableObjects: stock.bookableObjects,
        events: eventsByTenant.get(tenant.id) || 0,
        revenueEur: roundMoney(revenueByTenant.get(tenant.id)?.revenueEur || 0),
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
      revenueEur: 0,
    };

    for (const row of byTenant) {
      totals.bookings += row.bookings;
      totals.cancellations += row.cancellations;
      totals.bookables += row.bookables;
      totals.bookableObjects += row.bookableObjects;
      totals.events += row.events;
      totals.revenueEur += row.revenueEur;
    }
    totals.revenueEur = roundMoney(totals.revenueEur);

    return {
      from: toIsoOrNull(fromMs),
      to: toIsoOrNull(toMs),
      totals,
      byTenant,
    };
  }

  static async _buildTenantSummary(tenant, filters) {
    const tenantIds = [tenant.id];
    const { fromMs, toMs, bookableId, statusKey, isBookable, byBookableLimit } =
      filters;

    const [
      membershipsByTenant,
      bookablesByTenant,
      eventsByTenant,
      bookingsByTenant,
      cancellationsByTenant,
      revenueByTenant,
      byBookableRows,
      createdAtMap,
    ] = await Promise.all([
      DashboardManager.countActiveMembershipsByTenant(tenantIds),
      DashboardManager.countBookablesByTenant(tenantIds, isBookable),
      DashboardManager.countEventsByTenant(tenantIds),
      DashboardManager.aggregateBookingCountsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKey,
        includeByStatus: true,
      }),
      DashboardManager.aggregateCancellationsByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        statusKey,
      }),
      DashboardManager.aggregateRevenueByTenant({
        tenantIds,
        fromMs,
        toMs,
        bookableId,
        byMonth: true,
      }),
      DashboardManager.aggregateByBookable({
        tenantId: tenant.id,
        fromMs,
        toMs,
        bookableId,
        statusKey,
      }),
      DashboardManager.getTenantCreatedAtMap(tenantIds),
    ]);

    const stock = bookablesByTenant.get(tenant.id) || {
      bookables: 0,
      bookableObjects: 0,
    };
    const booking = bookingsByTenant.get(tenant.id) || {
      bookings: 0,
      byStatus: emptyStatusCounts(),
    };
    const revenue = revenueByTenant.get(tenant.id) || {
      revenueEur: 0,
      months: new Map(),
    };

    const tenantCreatedAt = createdAtMap.get(tenant.id) || 0;
    const nowMs = Date.now();
    const rangeStart = Math.max(
      fromMs != null ? fromMs : tenantCreatedAt,
      tenantCreatedAt,
    );
    const rangeEnd = toMs != null ? Math.min(toMs, nowMs) : nowMs;
    const revenueByMonth =
      rangeStart <= rangeEnd
        ? zeroFillRevenueByMonth(revenue.months, rangeStart, rangeEnd).map(
            (row) => ({
              month: row.month,
              revenueEur: roundMoney(row.revenueEur),
            }),
          )
        : [];

    const sorted = sortByBookableRows(byBookableRows);
    const byBookable = sorted.slice(0, byBookableLimit);
    const byBookableHasMore = sorted.length > byBookableLimit;

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      from: toIsoOrNull(fromMs),
      to: toIsoOrNull(toMs),
      totals: {
        users: membershipsByTenant.get(tenant.id) || 0,
        bookings: booking.bookings || 0,
        cancellations: cancellationsByTenant.get(tenant.id) || 0,
        bookables: stock.bookables,
        bookableObjects: stock.bookableObjects,
        events: eventsByTenant.get(tenant.id) || 0,
        revenueEur: roundMoney(revenue.revenueEur),
      },
      byStatus: statusArrayFromCounts(booking.byStatus || emptyStatusCounts()),
      revenueByMonth,
      byBookable,
      byBookableHasMore,
      byBookableLimit,
    };
  }
}

module.exports = DashboardService;
module.exports.DEFAULT_BY_BOOKABLE_LIMIT = DEFAULT_BY_BOOKABLE_LIMIT;
module.exports.MAX_BY_BOOKABLE_LIMIT = MAX_BY_BOOKABLE_LIMIT;
module.exports.parseFilters = parseFilters;
module.exports.clampByBookableLimit = clampByBookableLimit;
module.exports.zeroFillRevenueByMonth = zeroFillRevenueByMonth;
module.exports.sortByBookableRows = sortByBookableRows;
