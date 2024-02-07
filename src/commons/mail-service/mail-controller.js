const MailerService = require("./mail-service");

const BookingManager = require("../data-managers/booking-manager");
const BookableManager = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const PdfService = require("../pdf-service/pdf-service");
const IdGenerator = require("../utilities/id-generator");
const TenantManager = require("../data-managers/tenant-manager");

class MailController {
  static formatDateTime(value) {
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
    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return formatter.format(new Date(value));
  }

  static formatCurrency(value) {
    const formatter = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    });
    return formatter.format(value);
  }

  static async getPopulatedBookables(bookingId, tenant) {
    let booking = await BookingManager.getBooking(bookingId, tenant);
    let bookables = (await BookableManager.getBookables(tenant)).filter((b) =>
      booking.bookableItems.some((bi) => bi.bookableId === b.id),
    );

    for (const bookable of bookables) {
      bookable._populated = {
        event: await EventManager.getEvent(bookable.eventId, bookable.tenant),
      };
    }

    return bookables;
  }

  static async generateBookingDetails(bookingId, tenantId) {
    let booking = await BookingManager.getBooking(bookingId, tenantId);
    let bookables = await MailController.getPopulatedBookables(
      bookingId,
      tenantId,
    );

    let content = `<strong>Buchungsnummer:</strong> ${booking.id}
            <br><strong>Gesamtbetrag:</strong> ${MailController.formatCurrency(
              booking.priceEur,
            )}             
            <br><strong>Firma:</strong> ${
              !booking.company ? "" : booking.company
            }
            <br><strong>Name:</strong> ${!booking.name ? "" : booking.name}
            <br><strong>Adresse:</strong> ${
              !booking.street ? "" : booking.street
            } in ${!booking.zipCode ? "" : booking.zipCode} ${
              !booking.location ? "" : booking.location
            }
            <br><strong>Telefon:</strong> ${!booking.phone ? "" : booking.phone}
            <br><strong>E-Mail:</strong> ${!booking.mail ? "" : booking.mail}
            <br><br><strong>Hinweise zur Buchung:</strong>
            <br>    ${!booking.comment ? "" : booking.comment}<br>`;

    if (booking.timeBegin && booking.timeEnd) {
      content += `<br><strong>Buchungszeitraum:</strong> ${MailController.formatDateTime(
        booking.timeBegin,
      )} - ${MailController.formatDateTime(booking.timeEnd)}`;
    }

    content += `<br>
            <h2>Bestellübersicht</h2>`;

    for (const bookableItem of booking.bookableItems) {
      const bookable = bookables.find((b) => b.id === bookableItem.bookableId);
      content += `<div style="border-bottom: solid 1px grey; margin-bottom: 10px; padding-bottom: 10px;">
                <strong>${bookable.title}, Anzahl: ${bookableItem.amount}</strong>`;

      if (
        bookable.type === "ticket" &&
        bookable.eventId &&
        bookable._populated?.event
      ) {
        content += `<div style="color: grey">
                    Ticket für die Veranstaltung ${
                      bookable._populated.event.information.name
                    }<br>
                    vom ${MailController.formatDate(
                      bookable._populated.event.information.startDate,
                    )} ${
                      bookable._populated.event.information.startTime
                    } bis ${MailController.formatDate(
                      bookable._populated.event.information.endDate,
                    )} ${bookable._populated.event.information.endTime}<br>
                    Ort: ${bookable._populated.event.eventLocation.name}, ${
                      bookable._populated.event.eventAddress.street
                    }, ${bookable._populated.event.eventAddress.houseNumber} ${
                      bookable._populated.event.eventAddress.zip
                    } ${bookable._populated.event.eventAddress.city}
                </div>`;
      }

      content += `</div>`;
    }

    if (booking.coupon) {
      const coupon = booking.coupon;
      if (coupon.type === "fixed") {
        content += `<div style="color: grey">
                    Gutschein: ${coupon.description} (-${coupon.value}€)<br>
                </div>`;
      } else if (coupon.type === "percentage") {
        content += `<div style="color: grey">
                    Gutschein: ${coupon.description} (-${coupon.value}%)<br>
                </div>`;
      }
    }

    return content;
  }

  static async sendBookingConfirmation(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    let content = `<p>Im Folgenden senden wir Ihnen die Details Ihrer Buchung.</p><br>`;
    content += await MailController.generateBookingDetails(bookingId, tenantId);

    let attachments = undefined;

    if (booking?.priceEur > 0) {
      const receiptId = await IdGenerator.next(tenantId, 4);
      const receiptNumber = `${tenant.receiptNumberPrefix}-${receiptId}`;
      const pdfBuffer = await PdfService.generateReceipt(
        bookingId,
        tenantId,
        receiptNumber,
      );
      attachments = [
        {
          filename: `Zahlungsbeleg-${receiptNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ];
    }

    await MailerService.send(
      tenantId,
      address,
      `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      tenant.genericMailTemplate,
      {
        title: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
        content: content,
      },
      attachments,
      tenant.mail,
    );
  }

  static async sendFreeBookingConfirmation(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Im Folgenden senden wir Ihnen die Details Ihrer Buchung.</p><br>`;
    content += await MailController.generateBookingDetails(bookingId, tenantId);

    await MailerService.send(
      tenantId,
      address,
      `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      tenant.genericMailTemplate,
      {
        title: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
        content: content,
      },
      undefined,
      tenant.mail,
    );
  }

  static async sendBookingRequestConfirmation(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}. Wir haben Ihre Anfrage erhalten und bearbeiten diese schnellstmöglich.</p><br>`;
    content += await MailController.generateBookingDetails(bookingId, tenantId);

    await MailerService.send(
      tenantId,
      address,
      `Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}`,
      tenant.genericMailTemplate,
      {
        title: `Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}`,
        content: content,
      },
    );
  }

  static async sendPaymentRequest(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}. Wir haben diese erfolgreich geprüft und freigegeben. Bitte nutzen Sie den folgenden Link, um Ihre Buchung abzuschließen.</p><br>`;

    const paymentLink = `${process.env.FRONTEND_URL}/payment/redirection?id=${bookingId}&tenant=${tenantId}`;
    content += `<p><a href="${paymentLink}">${paymentLink}</a></p>`;

    content += await MailController.generateBookingDetails(bookingId, tenantId);

    await MailerService.send(
      tenantId,
      address,
      `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
      tenant.genericMailTemplate,
      {
        title: `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
        content: content,
      },
    );
  }

  static async sendIncomingBooking(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Es liegt eine neue Buchungsanfrage vor.</p><br>`;
    content += await MailController.generateBookingDetails(bookingId, tenantId);
    await MailerService.send(
      tenantId,
      address,
      "Eine neue Buchungsanfrage liegt vor",
      tenant.genericMailTemplate,
      {
        title: "Eine neue Buchungsanfrage liegt vor",
        content: content,
      },
    );
  }

  static async sendVerificationRequest(address, hookId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Um Ihre E-Mail-Adresse zu bestätigen, klicken Sie bitte auf den nachfolgenden Link</p><a href="${process.env.BACKEND_URL}/auth/${tenantId}/verify/${hookId}">${process.env.BACKEND_URL}/auth/${tenantId}/verify/${hookId}</a>`;

    await MailerService.send(
      tenantId,
      address,
      "Bestätigen Sie Ihre E-Mail-Adresse",
      tenant.genericMailTemplate,
      {
        title: "Bestätigen Sie Ihre E-Mail-Adresse",
        content: content,
      },
    );
  }

  static async sendPasswordResetRequest(address, hookId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    let content = `<p>Ihr Kennwort wurde geändert. Um die Änderung zu bestätigen, klicken Sie bitte auf den nachfolgenden Link.<br>Falls Sie keine Änderung an Ihrem Kennwort vorgenommen haben, können Sie diese Nachricht ignorieren.</p><a href="${process.env.BACKEND_URL}/auth/${tenantId}/reset/${hookId}">${process.env.BACKEND_URL}/auth/${tenantId}/reset/${hookId}</a>`;

    await MailerService.send(
      tenantId,
      address,
      "Bestätigen Sie die Änderung Ihres Passworts",
      tenant.genericMailTemplate,
      {
        title: "Bestätigen Sie die Änderung Ihres Passworts",
        content: content,
      },
    );
  }
}

module.exports = MailController;
