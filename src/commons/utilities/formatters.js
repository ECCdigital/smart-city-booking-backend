class Formatters {
  static formatDateTime(value) {
    if (!value) return "-";
    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    });
    return formatter.format(new Date(value));
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

  static translatePayMethod(value) {
    switch (value) {
      case "1":
        return "Giropay";
      case "17":
        return "Giropay";
      case "18":
        return "Giropay";
      case "2":
        return "eps";
      case "12":
        return "iDEAL";
      case "11":
        return "Kreditkarte";
      case "6":
        return "Lastschrift";
      case "7":
        return "Lastschrift";
      case "26":
        return "Bluecode";
      case "33":
        return "Maestro";
      case "14":
        return "PayPal";
      case "23":
        return "paydirekt";
      case "27":
        return "Sofortüberweisung";
      default:
        return "Unbekannt";
    }
  }
}

module.exports = Formatters;
