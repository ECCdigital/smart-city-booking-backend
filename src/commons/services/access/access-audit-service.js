const bunyan = require("bunyan");
const AccessLogManager = require("../../data-managers/access-log-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const PdfService = require("../../pdf-service/pdf-service");

const logger = bunyan.createLogger({
  name: "access-audit-service.js",
  level: process.env.LOG_LEVEL,
});

const DEFAULT_EXPORT_LIMIT = 50000;

// Keys that may carry sensitive secrets (PINs, codes, tokens). They are
// redacted before the payload is rendered into a compliance export. The match
// is on the whole key by design: `payload.presentedScanCode` names the sticker
// someone held up to a door and has to stay readable for an investigation.
const SENSITIVE_KEYS = [
  "pin",
  "code",
  "secret",
  "token",
  "apiToken",
  "password",
  "clientSecret",
];

/**
 * Builds tenant-wide audit exports (CSV / PDF) from the `accessLogs`
 * collection for compliance purposes (see ACCESS_POINTS_IMPLEMENTATION_PLAN §7).
 */
class AccessAuditService {
  /**
   * Resolve the export limit. Configurable via `ACCESS_AUDIT_EXPORT_LIMIT`.
   */
  static _getExportLimit() {
    const configured = parseInt(process.env.ACCESS_AUDIT_EXPORT_LIMIT, 10);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_EXPORT_LIMIT;
  }

  /**
   * Normalize raw query params into the manager filter shape.
   * Accepts ISO date strings or epoch ms for `from` / `to`.
   */
  static _normalizeFilters(params = {}) {
    const filters = {};

    const parseTime = (value) => {
      if (value == null || value === "") return undefined;
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) return asNumber;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    };

    const from = parseTime(params.from);
    const to = parseTime(params.to);
    if (from !== undefined) filters.from = from;
    if (to !== undefined) filters.to = to;

    if (params.bookingId) filters.bookingId = String(params.bookingId);
    if (params.accessPointId)
      filters.accessPointId = String(params.accessPointId);
    if (params.provider) filters.provider = String(params.provider);
    if (params.action) filters.action = String(params.action);
    if (params.result) filters.result = String(params.result);

    filters.limit = AccessAuditService._getExportLimit();

    return filters;
  }

  /**
   * Fetch audit log entries for a tenant and map them to flat, export-friendly
   * rows. Sensitive payload values are redacted.
   *
   * @param {string} tenantId
   * @param {Object} params - raw filter params (see _normalizeFilters)
   * @returns {Promise<Array<Object>>}
   */
  static async getAuditEntries(tenantId, params = {}) {
    const filters = AccessAuditService._normalizeFilters(params);
    const logs = await AccessLogManager.query(tenantId, filters);

    return logs.map((log) => ({
      timestamp: log.timestamp,
      timestampFormatted: AccessAuditService._formatDateTime(log.timestamp),
      action: log.action || "",
      result: log.result || "",
      blockingReasons: (log.blockingReasons || []).join(", "),
      channel: log.channel || "",
      // Blank, not "Nein", where the entry predates the field: a compliance
      // export must not claim a fact that was never recorded.
      evidenceBypassed: AccessAuditService._formatFlag(log.evidenceBypassed),
      accessPointId: log.accessPointId || "",
      accessPointType: log.accessPointType || "",
      provider: log.provider || "",
      externalId: log.externalId || "",
      bookingId: log.bookingId || "",
      actorUserId: log.actor?.userId || "",
      actorSource: log.actor?.source || "",
      errorCode: log.errorCode || "",
      errorMessage: log.errorMessage || "",
      details: AccessAuditService._stringifyPayload(log.payload),
    }));
  }

  static _formatFlag(value) {
    if (value == null) return "";
    return value === true ? "Ja" : "Nein";
  }

  static _formatDateTime(value) {
    if (!value) return "";
    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Berlin",
    });
    return formatter.format(new Date(value));
  }

  /**
   * Recursively redact sensitive keys, then serialize the payload to a compact
   * JSON string suitable for a single CSV / table cell.
   */
  static _stringifyPayload(payload) {
    if (payload == null) return "";
    try {
      const sanitized = AccessAuditService._redact(payload);
      if (
        sanitized &&
        typeof sanitized === "object" &&
        Object.keys(sanitized).length === 0
      ) {
        return "";
      }
      return JSON.stringify(sanitized);
    } catch (err) {
      logger.warn(`Could not serialize access log payload: ${err.message}`);
      return "";
    }
  }

  static _redact(value) {
    if (Array.isArray(value)) {
      return value.map((item) => AccessAuditService._redact(item));
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        if (SENSITIVE_KEYS.includes(key)) {
          result[key] = "***";
        } else {
          result[key] = AccessAuditService._redact(val);
        }
      }
      return result;
    }
    return value;
  }

  static get COLUMN_LABELS() {
    return {
      timestampFormatted: "Zeitpunkt",
      action: "Aktion",
      result: "Ergebnis",
      // Next to the result, because that is where they are read: a denial
      // without its reasons, its channel and the bypass flag cannot be judged.
      blockingReasons: "Blockierungsgründe",
      channel: "Kanal",
      evidenceBypassed: "Evidence-Bypass",
      accessPointId: "Access-Point-ID",
      accessPointType: "Typ",
      provider: "Anbieter",
      externalId: "Externe ID",
      bookingId: "Buchungsnummer",
      actorUserId: "Benutzer",
      actorSource: "Quelle",
      errorCode: "Fehlercode",
      errorMessage: "Fehlermeldung",
      details: "Details",
    };
  }

  /**
   * Render audit entries as a semicolon-separated CSV string (Excel-friendly).
   */
  static toCsv(entries) {
    const labels = AccessAuditService.COLUMN_LABELS;
    const keys = Object.keys(labels);
    const header = keys.map((k) => labels[k]).join(";");

    if (!entries || entries.length === 0) {
      // BOM + header so the export is still a valid, openable file.
      return "\uFEFF" + header;
    }

    const escapeCell = (value) => {
      const str = value == null ? "" : String(value);
      const sanitized = str.replace(/\r?\n/g, " ");
      if (
        sanitized.includes(";") ||
        sanitized.includes('"') ||
        sanitized.includes(",")
      ) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    };

    const lines = entries.map((entry) =>
      keys.map((k) => escapeCell(entry[k])).join(";"),
    );

    // BOM ensures Excel on Windows opens the UTF-8 CSV correctly.
    return "\uFEFF" + [header, ...lines].join("\r\n");
  }

  /**
   * Render audit entries as a PDF buffer via the shared PdfService.
   *
   * @param {string} tenantId
   * @param {Array<Object>} entries
   * @param {Object} params - the (raw) filter params, used for the header
   * @returns {Promise<{buffer: Buffer, name: string}>}
   */
  static async toPdf(tenantId, entries, params = {}) {
    const tenant = await TenantManager.getTenant(tenantId);
    const html = AccessAuditService._buildPdfHtml(tenant, entries, params);
    const filename = `Access-Audit-${tenantId}-${Date.now()}.pdf`;
    return PdfService.convertToPdf(html, filename);
  }

  static _escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  static _buildPdfHtml(tenant, entries, params = {}) {
    const labels = AccessAuditService.COLUMN_LABELS;
    // `details` is omitted from the PDF table to keep rows readable; it stays
    // available in the CSV export.
    const columns = Object.keys(labels).filter((k) => k !== "details");

    const headerCells = columns
      .map((k) => `<th>${AccessAuditService._escapeHtml(labels[k])}</th>`)
      .join("");

    const rows =
      entries && entries.length > 0
        ? entries
            .map((entry) => {
              const cells = columns
                .map(
                  (k) => `<td>${AccessAuditService._escapeHtml(entry[k])}</td>`,
                )
                .join("");
              return `<tr>${cells}</tr>`;
            })
            .join("")
        : `<tr><td colspan="${columns.length}">Keine Daten vorhanden</td></tr>`;

    const tenantName = AccessAuditService._escapeHtml(
      tenant?.name || tenant?.id || "",
    );
    const generatedAt = AccessAuditService._formatDateTime(Date.now());

    const rangeParts = [];
    if (params.from)
      rangeParts.push(`von ${AccessAuditService._escapeHtml(params.from)}`);
    if (params.to)
      rangeParts.push(`bis ${AccessAuditService._escapeHtml(params.to)}`);
    const rangeInfo = rangeParts.length
      ? `<p>Zeitraum: ${rangeParts.join(" ")}</p>`
      : "";

    const filterParts = [];
    if (params.bookingId)
      filterParts.push(
        `Buchung: ${AccessAuditService._escapeHtml(params.bookingId)}`,
      );
    if (params.accessPointId)
      filterParts.push(
        `Access-Point: ${AccessAuditService._escapeHtml(params.accessPointId)}`,
      );
    if (params.provider)
      filterParts.push(
        `Anbieter: ${AccessAuditService._escapeHtml(params.provider)}`,
      );
    if (params.action)
      filterParts.push(
        `Aktion: ${AccessAuditService._escapeHtml(params.action)}`,
      );
    if (params.result)
      filterParts.push(
        `Ergebnis: ${AccessAuditService._escapeHtml(params.result)}`,
      );
    const filterInfo = filterParts.length
      ? `<p>Filter: ${filterParts.join(" · ")}</p>`
      : "";

    const count = entries ? entries.length : 0;

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9px;
    color: #222;
    margin: 0;
  }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 9px; margin-bottom: 12px; }
  .meta p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    border: 1px solid #ddd;
    padding: 3px 4px;
    text-align: left;
    word-break: break-word;
    vertical-align: top;
  }
  thead th { background: #f0f0f0; }
  tbody tr:nth-child(even) { background: #fafafa; }
</style>
</head>
<body>
  <h1>Access-Audit-Export</h1>
  <div class="meta">
    <p>Mandant: ${tenantName}</p>
    <p>Erstellt am: ${generatedAt}</p>
    ${rangeInfo}
    ${filterInfo}
    <p>Einträge: ${count}</p>
  </div>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  }
}

module.exports = AccessAuditService;
