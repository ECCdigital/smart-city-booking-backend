const { RolePermission } = require("../../../commons/entities/role");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const Formatters = require("../../../commons/utilities/formatters");
const UserManager = require("../../../commons/data-managers/user-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
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

  static async _hasPermission(event, userId, tenant) {
    if (
      event.tenantId === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateAny",
      ))
    )
      return true;

    if (
      event.tenantId === tenant &&
      event.ownerUserId ===
        userId(
          await UserManager.hasPermission(
            userId,
            tenant,
            RolePermission.MANAGE_BOOKABLES,
            "updateOwn",
          ),
        )
    )
      return true;

    return false;
  }

  static async getEventBookings(request, response) {
    try {
      const {
        params: { tenant: tenantId, id: eventId },
        user,
      } = request;

      const event = await EventManager.getEvent(eventId, tenantId);
      if (
        !(await CsvExportController._hasPermission(event, user?.id, tenantId))
      ) {
        return response.sendStatus(403);
      }

      const eventBookings = await BookingManager.getEventBookings(
        tenantId,
        eventId,
      );

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
