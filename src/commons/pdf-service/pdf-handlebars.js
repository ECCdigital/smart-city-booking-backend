const Handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");
const {
  formatDateTime,
  formatDate,
  formatCurrency,
  formatNegativeCurrency,
  formatAmount,
  translatePayMethod,
} = require("./pdf-formatters");

/**
 * Registers all Handlebars helpers and partials that are available inside
 * PDF templates (default templates as well as tenant-specific overrides).
 *
 * Helpers shared with the mail service (formatDate, formatDateTime) are only
 * registered when they are not present yet, so both services stay consistent
 * no matter which one is loaded first.
 */

function registerHelperIfMissing(name, fn) {
  if (!Handlebars.helpers[name]) {
    Handlebars.registerHelper(name, fn);
  }
}

registerHelperIfMissing("formatDateTime", (value) => {
  if (!value) return "–";
  return formatDateTime(value);
});

registerHelperIfMissing("formatDate", (value) => {
  if (!value) return "–";
  return formatDate(value);
});

registerHelperIfMissing("formatCurrency", (value) => formatCurrency(value));
registerHelperIfMissing("formatNegativeCurrency", (value) =>
  formatNegativeCurrency(value),
);
registerHelperIfMissing("formatAmount", (value) => formatAmount(value));
registerHelperIfMissing("payMethod", (value) => translatePayMethod(value));
registerHelperIfMissing("eq", (a, b) => a === b);

const PARTIALS = {
  pdfBookingItemsTable: "booking-items-table.temp.html",
  pdfAggregatedReceiptTable: "aggregated-receipt-table.temp.html",
  pdfAggregatedBookingsTable: "aggregated-bookings-table.temp.html",
};

for (const [name, filename] of Object.entries(PARTIALS)) {
  const partialPath = path.join(__dirname, "templates", "partials", filename);
  Handlebars.registerPartial(name, fs.readFileSync(partialPath, "utf-8"));
}

module.exports = Handlebars;
