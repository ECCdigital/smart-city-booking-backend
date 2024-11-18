const { RolePermission } = require("../../../commons/entities/role");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
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
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateAny",
      ))
    )
      return true;

    if (
      event.tenant === tenant &&
      event.ownerUserId === userId &&
      event.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKABLES,
        "updateOwn",
      ))
    )
      return true;

    return false;
  }

  static async getEventBookings(request, response) {
      try {
          const {
              params: {tenant: tenantId, id: eventId},
              user,
          } = request;

<<<<<<< Updated upstream
    const event = await EventManager.getEvent(eventId, tenantId);
    if (!(await CsvExportController._hasPermission(event, user?.id, tenantId))) {
      return response.sendStatus(403);
    }

    const eventBookings = await BookingManager.getEventBookings(tenantId, eventId);

    const attandeeList = eventBookings.map((b) => {
        return {
            id: b.id,
            ticket: b.bookableItems.length > 0 ? b.bookableItems[0]._bookableUsed?.title : "Unbekannt",
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
            payMethod: Formatters.translatePayMethod(b.payMethod),
          };
  });

    response.setHeader("Content-Type", "text/csv");
    response.status(200).send(
        '\uFEFF'  + CsvExportController._toCsv(attandeeList, {
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
        payMethod: "Zahlungsart",
      }),
    );
=======
          const event = await EventManager.getEvent(eventId, tenantId);
          if (!(await CsvExportController._hasPermission(event, user.id, tenantId))) {
              return response.sendStatus(403);
          }

          const bookables = await BookableManager.getBookables(tenantId);
          const eventTickets = bookables.filter(
              (b) => b.type === "ticket" && b.eventId == eventId,
          );

          const bookings = await BookingManager.getBookings(tenantId);
          const eventBookings = bookings
              .filter((b) => {
                  const validIds =
                      b.bookableIds.length > 0
                          ? b.bookableIds
                          : b.bookableItems.map((item) => item.bookableId);
                  return validIds.some((id) => eventTickets.some((t) => t.id == id));
              })
              .map((b) => {
                  const validIds =
                      b.bookableIds.length > 0
                          ? b.bookableIds
                          : b.bookableItems.map((item) => item.bookableId);
                  const ticket = eventTickets.find((t) => validIds.includes(t.id))?.title;

                  return {
                      id: b.id,
                      ticket,
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
                      payMethod: Formatters.translatePayMethod(b.payMethod),
                  };
              });

          const csvResult = CsvExportController._toCsv(eventBookings, {
              id: "Buchungsnummer",
              ticket: "Ticket",
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
              payMethod: "Zahlungsart",
          });

          response.setHeader("Content-Type", "text/csv");
          response.status(200).send(csvResult);
      } catch (err) {
          logger.error(err);
          response.status(500).send("could not get event bookings");
      }
>>>>>>> Stashed changes
  }
}

module.exports = CsvExportController;
