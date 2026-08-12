const { v4: uuidv4 } = require("uuid");
const AccessLogManager = require("../../data-managers/access-log-manager");

const DEFAULT_RETENTION_DAYS = 730;

class AccessLogService {
  static async log(entry) {
    const timestamp = entry.timestamp || Date.now();
    const retentionDays = this._getRetentionDays();

    return AccessLogManager.insert({
      id: entry.id || uuidv4(),
      tenantId: entry.tenantId,
      bookingId: entry.bookingId || null,
      accessPointId: entry.accessPointId || null,
      accessPointType: entry.accessPointType || null,
      provider: entry.provider || null,
      externalId: entry.externalId || null,
      action: entry.action,
      actor: entry.actor || { source: "system" },
      result: entry.result || "pending",
      blockingReasons: entry.blockingReasons || [],
      channel: entry.channel ?? null,
      evidenceBypassed: entry.evidenceBypassed === true,
      payload: entry.payload || {},
      errorCode: entry.errorCode || null,
      errorMessage: entry.errorMessage || null,
      timestamp,
      expiresAt: new Date(timestamp + retentionDays * 24 * 60 * 60 * 1000),
    });
  }

  static _getRetentionDays() {
    const configured = parseInt(process.env.ACCESS_LOG_RETENTION_DAYS, 10);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RETENTION_DAYS;
  }
}

module.exports = AccessLogService;
