/**
 * Shared formatting functions for PDF documents. Used by the PdfService
 * generators as well as the Handlebars helpers that are available inside
 * PDF templates.
 */

function formatDateTime(value) {
  const date = new Date(value);
  // Bereits formatierte Strings (z. B. "15.07.2026, 10:24") unverändert
  // durchreichen statt mit "Invalid time value" zu werfen.
  if (isNaN(date.getTime())) return String(value);
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  return formatter.format(date);
}

function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return formatter.format(date);
}

function formatCurrency(value) {
  if (value == null || isNaN(value)) return "-";
  const formatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  });
  return formatter.format(value);
}

function formatNegativeCurrency(value) {
  if (value == null || isNaN(value)) return "-";
  const formatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  });
  return formatter.format(Math.abs(value) * -1);
}

function formatAmount(value) {
  if (value == null || isNaN(value)) return "-";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const PAY_METHOD_LABELS = {
  CASH: "Bar",
  TRANSFER: "Überweisung",
  CREDIT_CARD: "Kreditkarte",
  DEBIT_CARD: "EC-Karte",
  PAYPAL: "PayPal",
  OTHER: "Sonstiges",
  GIROPAY: "Giropay",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  EPS: "EPS",
  IDEAL: "iDEAL",
  MAESTRO: "Maestro",
  PAYDIRECT: "paydirekt",
  SOFORT: "SOFORT-Überweisung",
  BLUECODE: "Bluecode",
};

function translatePayMethod(value) {
  return PAY_METHOD_LABELS[value] || "Unbekannt";
}

module.exports = {
  formatDateTime,
  formatDate,
  formatCurrency,
  formatNegativeCurrency,
  formatAmount,
  translatePayMethod,
};
