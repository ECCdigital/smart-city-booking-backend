const Formatters = require("../../../commons/utilities/formatters");
const BookingService = require("../../../commons/services/checkout/booking-service");
const { scopeOf } = require("../../../commons/services/authorization");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "csv-export-controller.js",
  level: process.env.LOG_LEVEL,
});

class CsvExportController {
  // transform a list of objects to a csv string
  static _toCsv(objects, headerTranslations = {}) {
    if (objects.length === 0) {
      return "Keine Daten vorhanden";
    }

    const keys = Object.keys(objects[0]);
    const header = keys.map((k) => headerTranslations[k] || k).join(";");
    const lines = objects.map((o) => keys.map((k) => o[k]).join(";"));
    return [header, ...lines].join("\r\n");
  }

  /**
   * GET /csv/:tenant/events/:id/bookings
   *
   * The attendee list of an event, for whoever may change the event
   * (`exporter.export`). The reach applies to the event: under `any` every
   * event of the tenant, under `own` only the ones the caller owns - an
   * event out of reach is a 404, not a 403 (glossary "Reichweite"); its bookings the
   * domain reads whole (ADR 0002).
   */
  static async getEventBookings(request, response) {
    const {
      params: { tenant: tenantId, id: eventId },
    } = request;

    const eventBookings = await BookingService.getEventBookings(
      tenantId,
      eventId,
      scopeOf(request),
    );

    try {
      const attendeeList = eventBookings.map((b) => {
        return {
          id: b.id,
          ticket:
            b.bookableItems.length > 0
              ? b.bookableItems[0]._bookableUsed?.title
              : "Unbekannt",
          amount: b.bookableItems.length > 0 ? b.bookableItems[0].amount : "0",
          assignedUserId: b.assignedUserId,
          mail: b.mail,
          company: b.company,
          name: b.name,
          street: b.street,
          zipCode: b.zipCode,
          location: b.location,
          comment: b.comment?.replace(/(\r\n|\n|\r)/gm, " "),
          timeBegin: Formatters.formatDateTime(b.timeBegin),
          timeEnd: Formatters.formatDateTime(b.timeEnd),
          timeCreated: Formatters.formatDateTime(b.timeCreated),
          isCommitted: b.isCommitted ? "Ja" : "Nein",
          isPayed: b.isPayed ? "Ja" : "Nein",
          priceEur: Formatters.formatCurrency(b.priceEur),
          paymentMethod: Formatters.translatePayMethod(b.paymentMethod),
        };
      });

      // Using the BOM character to ensure that Excel opens the CSV file correctly on Windows Machines
      const csvResult =
        "\uFEFF" +
        CsvExportController._toCsv(attendeeList, {
          id: "Buchungsnummer",
          ticket: "Ticket",
          amount: "Anzahl",
          assignedUserId: "Angemeldeter Benutzer",
          mail: "E-Mail Adresse",
          company: "Firma",
          name: "Name",
          street: "Straße",
          zipCode: "PLZ",
          location: "Ort",
          comment: "Buchungshinweise",
          timeBegin: "Buchungsbeginn",
          timeEnd: "Buchungsende",
          timeCreated: "Buchungsdatum",
          isCommitted: "Buchung bestätigt",
          isPayed: "Buchung bezahlt",
          priceEur: "Preis",
          paymentMethod: "Zahlungsart",
        });

      response.setHeader("Content-Type", "text/csv");
      response.status(200).send(csvResult);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get event bookings");
    }
  }
}

module.exports = CsvExportController;
