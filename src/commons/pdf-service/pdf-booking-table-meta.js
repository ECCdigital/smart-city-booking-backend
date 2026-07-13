const DEFAULT_PDF_BOOKING_TABLE_META = {
  showBookingId: true,
  showBookingPeriod: true,
  showPaymentDate: true,
  showPaymentMethod: true,
};

const PDF_BOOKING_TABLE_META_KEYS = Object.keys(DEFAULT_PDF_BOOKING_TABLE_META);

/**
 * Resolves which booking metadata fields are shown inside PDF table partials.
 * Template variables (booking.id, booking.period, …) are always available
 * regardless of these flags.
 */
function resolveBookingTableMeta(tenant, override = null) {
  const meta = { ...DEFAULT_PDF_BOOKING_TABLE_META };

  const tenantMeta = tenant?.pdfBookingTableMeta;
  if (tenantMeta && typeof tenantMeta === "object" && !Array.isArray(tenantMeta)) {
    for (const key of PDF_BOOKING_TABLE_META_KEYS) {
      if (typeof tenantMeta[key] === "boolean") {
        meta[key] = tenantMeta[key];
      }
    }
  }

  if (override && typeof override === "object" && !Array.isArray(override)) {
    for (const key of PDF_BOOKING_TABLE_META_KEYS) {
      if (typeof override[key] === "boolean") {
        meta[key] = override[key];
      }
    }
  }

  return enrichBookingTableMeta(meta);
}

function enrichBookingTableMeta(tableMeta) {
  const showPaymentInTable =
    tableMeta.showPaymentDate || tableMeta.showPaymentMethod;
  const showSingleBookingHeader =
    tableMeta.showBookingId ||
    tableMeta.showBookingPeriod ||
    showPaymentInTable;

  const aggregatedMetaColumnCount =
    (tableMeta.showBookingId ? 1 : 0) +
    (tableMeta.showBookingPeriod ? 1 : 0) +
    (tableMeta.showPaymentDate ? 1 : 0) +
    (tableMeta.showPaymentMethod ? 1 : 0);

  const aggregatedReceiptColumnCount = aggregatedMetaColumnCount + 1;
  const aggregatedInvoiceColumnCount =
    (tableMeta.showBookingId ? 1 : 0) +
    (tableMeta.showBookingPeriod ? 1 : 0) +
    1;

  return {
    ...tableMeta,
    showPaymentInTable,
    showSingleBookingHeader,
    aggregatedMetaColumnCount,
    aggregatedReceiptColumnCount: Math.max(aggregatedReceiptColumnCount, 1),
    aggregatedInvoiceColumnCount: Math.max(aggregatedInvoiceColumnCount, 1),
    aggregatedReceiptLabelColspan: Math.max(aggregatedReceiptColumnCount - 1, 0),
    aggregatedInvoiceLabelColspan: Math.max(aggregatedInvoiceColumnCount - 1, 0),
    showAggregatedPaymentColumn: showPaymentInTable,
  };
}

function validatePdfBookingTableMeta(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return "Invalid pdfBookingTableMeta: expected an object";
  }

  for (const key of Object.keys(value)) {
    if (!PDF_BOOKING_TABLE_META_KEYS.includes(key)) {
      return `Invalid pdfBookingTableMeta key "${key}". Allowed keys: ${PDF_BOOKING_TABLE_META_KEYS.join(", ")}`;
    }
    if (typeof value[key] !== "boolean") {
      return `Invalid pdfBookingTableMeta.${key}: expected a boolean`;
    }
  }

  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCompactMetaHtml(booking, tableMeta) {
  if (!booking || !tableMeta.showSingleBookingHeader) {
    return null;
  }

  const parts = [];
  if (tableMeta.showBookingId) {
    parts.push(`Buchung <strong>${escapeHtml(booking.id)}</strong>`);
  }
  if (tableMeta.showBookingPeriod) {
    parts.push(escapeHtml(booking.period));
  }
  if (booking.hasPayment && tableMeta.showPaymentInTable) {
    const paymentParts = [];
    if (tableMeta.showPaymentDate) {
      paymentParts.push(`bezahlt am ${escapeHtml(booking.paymentDate)}`);
    }
    if (tableMeta.showPaymentMethod) {
      const prefix = tableMeta.showPaymentDate ? "per " : "";
      paymentParts.push(`${prefix}${escapeHtml(booking.paymentMethod)}`);
    }
    if (paymentParts.length) {
      parts.push(paymentParts.join(" "));
    }
  }

  return parts.length ? parts.join(" &nbsp;·&nbsp; ") : null;
}

module.exports = {
  DEFAULT_PDF_BOOKING_TABLE_META,
  PDF_BOOKING_TABLE_META_KEYS,
  resolveBookingTableMeta,
  enrichBookingTableMeta,
  validatePdfBookingTableMeta,
  buildCompactMetaHtml,
};
