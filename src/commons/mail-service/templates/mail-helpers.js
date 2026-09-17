/**
 * The Handlebars helpers a mail template may call, registered on the
 * shared Handlebars instance at require time, and their names for the
 * save validation of `mail-snippet-overrides.js`, which refuses every
 * other helper. A pure module: no store, no transport.
 */

const Handlebars = require("handlebars");

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

Handlebars.registerHelper("formatDateTime", (value) => {
  if (!value) return "–";
  return dateTimeFormatter.format(new Date(value));
});

Handlebars.registerHelper("formatDate", (value) => {
  if (!value) return "–";
  return dateFormatter.format(new Date(value));
});

Handlebars.registerHelper("priceFormatted", (value) => {
  if (typeof value !== "number") return "–";
  return currencyFormatter.format(value);
});

Handlebars.registerHelper("sanitizeString", function (value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.replace(/<[^>]*>?/gm, "");
  }
  return value;
});
Handlebars.registerHelper("gt", function (a, b, options) {
  return a > b ? options.fn(this) : options.inverse(this);
});

// A text value made safe for a query string. Only a scalar encodes; null,
// undefined, objects, SafeStrings and the `options` object of a call without
// an argument render as "". Returns a plain string so `{{ }}` still
// HTML-escapes the result, which is right inside an attribute.
Handlebars.registerHelper("urlEncode", (value) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return encodeURIComponent(String(value));
});

// The helpers a mail template may call; the save validation of
// `mail-snippet-overrides.js` refuses every other name.
const MAIL_HELPER_NAMES = Object.freeze([
  "formatDateTime",
  "formatDate",
  "priceFormatted",
  "sanitizeString",
  "gt",
  "urlEncode",
]);

module.exports = { MAIL_HELPER_NAMES };
