const MAIL_BOOKING_PERIOD_FORMATS = [
  "default",
  "fromTo",
  "timeFirst",
  "long",
  "compact",
];

const TIME_ZONE = "Europe/Berlin";

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

const compactDateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

const longDateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});

class Formatters {
  static formatDateTime(value) {
    if (!value) return "-";
    return dateTimeFormatter.format(new Date(value));
  }

  static formatDate(value) {
    if (!value) return "-";

    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return formatter.format(new Date(value));
  }

  static formatCurrency(value) {
    if (!value) return "-";
    const formatter = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    });
    return formatter.format(value);
  }

  /**
   * Format a booking period for email templates using a tenant preset.
   * @param {number|string|Date} timeBegin
   * @param {number|string|Date} timeEnd
   * @param {string} [format="default"]
   * @returns {string}
   */
  static formatBookingPeriod(timeBegin, timeEnd, format = "default") {
    if (!timeBegin || !timeEnd) {
      return "";
    }

    const begin = new Date(timeBegin);
    const end = new Date(timeEnd);
    const preset = MAIL_BOOKING_PERIOD_FORMATS.includes(format)
      ? format
      : "default";

    switch (preset) {
      case "fromTo":
        return `von ${timeFormatter.format(begin)} Uhr am ${dateFormatter.format(begin)} bis ${timeFormatter.format(end)} Uhr am ${dateFormatter.format(end)}`;
      case "timeFirst":
        return `${timeFormatter.format(begin)} Uhr, ${dateFormatter.format(begin)} - ${timeFormatter.format(end)} Uhr, ${dateFormatter.format(end)}`;
      case "long":
        return `${longDateFormatter.format(begin)}, ${timeFormatter.format(begin)} Uhr - ${longDateFormatter.format(end)}, ${timeFormatter.format(end)} Uhr`;
      case "compact":
        return `${compactDateTimeFormatter.format(begin)} - ${compactDateTimeFormatter.format(end)}`;
      case "default":
      default:
        return `${dateTimeFormatter.format(begin)} - ${dateTimeFormatter.format(end)}`;
    }
  }

  static translatePayMethod(value) {
    switch (value) {
      case "CASH":
        return "Bar";
      case "TRANSFER":
        return "Überweisung";
      case "CREDIT_CARD":
        return "Kreditkarte";
      case "DEBIT_CARD":
        return "EC-Karte";
      case "PAYPAL":
        return "PayPal";
      case "OTHER":
        return "Sonstiges";
      case "GIROPAY":
        return "Giropay";
      case "APPLE_PAY":
        return "Apple Pay";
      case "GOOGLE_PAY":
        return "Google Pay";
      case "EPS":
        return "EPS";
      case "IDEAL":
        return "iDEAL";
      case "MAESTRO":
        return "Maestro";
      case "PAYDIRECT":
        return "paydirekt";
      case "SOFORT":
        return "SOFORT-Überweisung";
      case "BLUECODE":
        return "Bluecode";
      default:
        return "Unbekannt";
    }
  }
}

Formatters.MAIL_BOOKING_PERIOD_FORMATS = MAIL_BOOKING_PERIOD_FORMATS;

module.exports = Formatters;
