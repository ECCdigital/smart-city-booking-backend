const MailerService = require("./mail-service");
const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const bunyan = require("bunyan");
const PaymentUtils = require("../utilities/payment-utils");
const UserManager = require("../data-managers/user-manager");
const QRCode = require("qrcode");
const Handlebars = require("handlebars");
const GroupBookingManager = require("../data-managers/group-booking-manager");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});

class MailController {
  static async getPopulatedBookables(bookingId, tenant) {
    let booking = await BookingManager.getBooking(bookingId, tenant);
    let bookables = (await BookableManager.getBookables(tenant)).filter((b) =>
      booking.bookableItems.some((bi) => bi.bookableId === b.id),
    );

    for (const bookable of bookables) {
      bookable._populated = {
        event: await EventManager.getEvent(bookable.eventId, bookable.tenantId),
      };
    }

    return bookables;
  }

  static async _sendBookingMail({
    address,
    bookingId,
    tenantId,
    subject,
    title,
    message,
    includeQRCode = false,
    attachments = [],
    sendBCC = false,
    addRejectionLink = false,
  }) {
    const tenant = await TenantManager.getTenant(tenantId);

    let bookingDetails = "";
    if (bookingId) {
      bookingDetails = await this.generateBookingDetails(bookingId, tenantId);
    }

    let qrContent = "";
    let qrAttachment = null;
    if (includeQRCode) {
      const qrResult = await this.generateQRCode(bookingId, tenantId);
      qrContent = qrResult.content;
      qrAttachment = qrResult.attachment;
    }

    const rejectionUrl = addRejectionLink
      ? `${process.env.FRONTEND_URL}/booking/request-reject/${tenantId}?id=${bookingId}`
      : null;

    const snippetTemplateString = `
      {{{ message }}}<br>
      {{{ bookingDetails }}}
      
      {{#if rejectionUrl}}
        <br>
        <br>
        <a href="{{rejectionUrl}}"
          style="
             background-color: #e53935;
             color: #ffffff;
             padding: 12px 24px;
             border-radius: 4px;
             text-decoration: none;
             font-weight: bold;
             display: inline-block;">
          Buchung stornieren
        </a>
      {{/if}}
      
      {{#if qrContent}}
        <br>
        {{{ qrContent }}}
      {{/if}}`;

    const snippetData = {
      message,
      bookingDetails,
      rejectionUrl,
      qrContent,
    };

    const snippetHtml = renderSnippet(snippetTemplateString, snippetData);

    if (qrAttachment) {
      attachments = attachments
        ? [...attachments, qrAttachment]
        : [qrAttachment];
    }

    const model = {
      title,
      content: snippetHtml,
    };

    const bccEmail = sendBCC ? tenant.mail : undefined;

    await MailerService.send({
      tenantId: tenantId,
      address: address,
      subject: subject,
      mailTemplate: tenant.genericMailTemplate,
      model,
      attachments,
      bcc: bccEmail,
      useInstanceMail: tenant.useInstanceMail,
    });
  }

  static async generateBookingDetails(bookingId, tenantId) {
    let booking = await BookingManager.getBooking(bookingId, tenantId);
    let bookables = await MailController.getPopulatedBookables(
      bookingId,
      tenantId,
    );

    const bookingItems = booking.bookableItems.map((item) => {
      const bookable = bookables.find((b) => b.id === item.bookableId);
      const isTicket =
        bookable.type === "ticket" &&
        bookable.eventId &&
        bookable._populated?.event;

      let eventData = null;
      if (isTicket) {
        const event = bookable._populated.event;
        eventData = {
          name: event.information.name,
          startDate: event.information.startDate,
          startTime: event.information.startTime,
          endDate: event.information.endDate,
          endTime: event.information.endTime,
          locationName: event.eventLocation.name,
          locationStreet: event.eventAddress.street,
          locationHouseNumber: event.eventAddress.houseNumber,
          locationZip: event.eventAddress.zip,
          locationCity: event.eventAddress.city,
        };
      }

      return {
        amount: item.amount,
        isTicket,
        bookableTitle: bookable.title,
        bookingNotes: bookable.bookingNotes,
        event: eventData,
      };
    });

    let couponInfo = null;
    if (booking.coupon) {
      const coupon = booking.coupon;
      if (coupon.type === "fixed") {
        couponInfo = {
          description: coupon.description,
          value: coupon.value,
          isFixed: true,
        };
      } else if (coupon.type === "percentage") {
        couponInfo = {
          description: coupon.description,
          value: coupon.value,
          isFixed: false,
        };
      }
    }

    const snippetTemplateString = `
    <strong>Buchungsnummer:</strong> {{booking.id}}
    <br><strong>Gesamtbetrag:</strong> {{priceFormatted booking.priceEur}}
    <br><strong>Firma:</strong> {{#if booking.company}}{{booking.company}}{{else}} {{/if}}
    <br><strong>Name:</strong> {{#if booking.name}}{{booking.name}}{{else}} {{/if}}
    <br><strong>Adresse:</strong> {{#if booking.address}}{{booking.address}},{{else}} {{/if}} {{#if booking.zip}}{{booking.zip}}{{else}} {{/if}} {{#if booking.city}}{{booking.city}}{{else}} {{/if}}
    <br><strong>Telefon:</strong> {{#if booking.phone}}{{booking.phone}}{{else}} {{/if}}
    <br><strong>E-Mail:</strong> {{#if booking.email}}{{booking.email}}{{else}} {{/if}}
    <br><br><strong>Hinweise zur Buchung:</strong> 
    <br> {{#if booking.comment}}{{booking.comment}}{{else}} {{/if}}
    
    {{#if booking.timeBegin}}
      <br><strong>Buchungszeitraum:</strong> {{formatDateTime booking.timeBegin}} - {{formatDateTime booking.timeEnd}}
    {{/if}}
    <br>
    <h2>Bestellübersicht</h2>
    
    {{#each bookingItems}}
      <div style="border-bottom: solid 1px grey; margin-bottom: 10px; padding-bottom: 10px;">
      <strong>{{bookableTitle}}, Anzahl: {{amount}}</strong>
      {{#if isTicket}}
        <div style="color: grey">
          Ticket für die Veranstaltung {{event.name}}<br>
          vom {{formatDate event.startDate}} {{event.startTime}}
          bis {{formatDate event.endDate}} {{event.endTime}}<br>
          Ort: {{event.locationName}}, {{event.locationStreet}}, {{event.locationHouseNumber}} {{event.locationZip}} {{event.locationCity}}
        </div>
      {{/if}}
      
      {{#if bookingNotes}}
        {{{bookingNotes}}}
      {{/if}}
      </div>
    {{/each}}
    
    {{#if coupon}}
      {{#if coupon.isFixed}}
        <div style="color: grey">
          Gutschein: {{coupon.description}} ( -{{coupon.value}} € )<br>
        </div>
      {{else}}
        <div style="color: grey">
          Gutschein: {{coupon.description}} ( -{{coupon.value}} % )<br>
        </div>
      {{/if}}
    {{/if}}`;

    const snippetData = {
      booking,
      bookingItems,
      coupon: couponInfo,
    };

    return renderSnippet(snippetTemplateString, snippetData);
  }

  static async generateGroupBookingDetails(groupBookingId, bookingIds, tenantId) {
    // 1) Hier könntest du aus deiner DB eine evtl. existierende Gruppenbuchung laden
    //    oder du bekommst ggf. die relevanten Daten schon direkt übergeben.
    //    Beispiel:
    const groupBooking = await GroupBookingManager.getGroupBooking(tenantId, groupBookingId);

    // 2) Einzel-Buchungen durchgehen und für jede Buchung das *Einzel-Snippet* abrufen
    //    Das hast du schon fertig in `generateBookingDetails(bookingId, tenantId)`.
    const subBookingSnippets = [];
    let totalPriceEur = 0;

    for (const bId of bookingIds) {
      // a) das fertige Einzel-Snippet holen
      const snippetHtml = await this.generateBookingDetails(bId, tenantId);
      // b) ins Array legen
      subBookingSnippets.push(snippetHtml);

      // c) Preis aufsummieren
      //    Evtl. musst du jede Buchung laden, um den Preis zu holen,
      //    oder du holst ihn schon in generateBookingDetails. Hier mal direkt aus DB:
      const booking = await BookingManager.getBooking(bId, tenantId);
      totalPriceEur += booking.priceEur;
    }

    // 3) Ggf. hat groupBooking selbst noch Felder: z. B. `groupBooking.comment`?
    //    Die kannst du im Template anzeigen.
    //    Hier als Beispiel mal so was wie "groupBooking.comment".

    // 4) Template für die Gruppenbuchung definieren:
    const snippetTemplateString = `
    <h1>Gruppenbuchung: {{groupBookingId}}</h1>
    <p>Gesamtpreis (Summe aller Teilbuchungen): {{formatCurrency totalPrice}}</p>
    
    {{#if comment}}
      <p><strong>Kommentar zur Gruppenbuchung:</strong> {{{ comment }}}</p>
    {{/if}}

    <div style="margin-top: 20px;">
      <!-- Jetzt alle Einzel-Buchungs-Snippets anzeigen -->
      {{#each subBookings}}
        <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc;">
          {{{this}}}
        </div>
      {{/each}}
    </div>
  `;

    // 5) Kompilieren
    const snippetTemplate = Handlebars.compile(snippetTemplateString);

    // 6) Rendering-Daten
    const snippetData = {
      groupBookingId,
      totalPrice: totalPriceEur,
      comment: groupBooking.comment, // falls existiert
      subBookings: subBookingSnippets, // Array der *fertigen* Einzel-Snippets
    };

    // Wichtig: du nutzt hier *deinen* Currency-Helper `formatCurrency`,
    // der in mail-service.js registriert ist.
    // Falls du hier *direkt* in JS formatieren willst, ginge das natürlich auch:
    // snippetData.totalPriceFormatted = MailController.formatCurrency(totalPriceEur);
    // Dann würdest du im Template `{{totalPriceFormatted}}` anzeigen.

    // 7) Fertiges HTML
    const groupSnippetHtml = snippetTemplate(snippetData);

    // 8) Zurückgeben, damit du das in `_sendBookingMail` oder anderswo einbauen kannst
    return groupSnippetHtml;
  }

  static async generateQRCode(bookingId, tenantId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    const AppUrl = process.env.FRONTEND_URL;
    const QRUrl = `${AppUrl}/booking/status/${tenantId}?id=${booking.id}&name=${encodeURIComponent(booking.name)}`;

    const qrCodeBuffer = await QRCode.toBuffer(QRUrl);

    const attachment = {
      filename: "qrcode.png",
      content: qrCodeBuffer,
      cid: "qrcode_cid",
    };

    const snippetTemplateString = `
    <p>Sie können den Status Ihrer Buchung jederzeit einsehen, indem Sie entweder auf den folgenden Button klicken oder den QR-Code scannen:</p>
    <a href="{{qrUrl}}"
       style="
         background-color: #0055a5;
         color: #ffffff;
         padding: 12px 24px;
         border-radius: 4px;
         text-decoration: none;
         font-weight: bold;
         display: inline-block;">
       Buchungsstatus ansehen
    </a>
    <br><br>
    <img src="cid:qrcode_cid" alt="QR Code" />
  `;

    const snippetHtml = renderSnippet(snippetTemplateString, { qrUrl: QRUrl });

    return {
      content: snippetHtml,
      attachment,
    };
  }

  static async sendBookingConfirmation(
    address,
    bookingId,
    tenantId,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);
    const includeQRCode = tenant.enablePublicStatusView;

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      title: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      message: `<p>Im Folgenden senden wir Ihnen die Details Ihrer Buchung.</p><br>`,
      includeQRCode: includeQRCode,
      attachments,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendBookingRejection(
    address,
    bookingId,
    tenantId,
    reason,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);

    const snippetTemplateString = `
    <p>Die nachfolgende Buchung wurde abgelehnt:</p>
    {{#if rejectionReason}}
      <p><strong>Ablehnungsgrund:</strong> {{sanitizeString  rejectionReason}} </p>
    {{/if}}`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      rejectionReason: reason,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Abgelehnt: Ihre Buchungsanfrage im ${tenant.name} wurde abgelehnt`,
      title: `Ihre Buchungsanfrage im ${tenant.name} wurde abgelehnt`,
      message: snippetHtml,
      includeQRCode: false,
      attachments,
      sendBCC: false,
      addRejectionLink: false,
    });
  }

  static async sendBookingCancel(
    address,
    bookingId,
    tenantId,
    reason,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);

    const snippetTemplateString = `
    <p>Die nachfolgende Buchung wurde storniert:</p>
    {{#if cancelReason}}
      <p><strong>Hinweis zur Stornierung</strong>: {{sanitizeString  cancelReason}} </p>
    {{/if}}`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      cancelReason: reason,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Stornierung: Ihre Buchung im ${tenant.name} wurde storniert`,
      title: `Ihre Buchung im ${tenant.name} wurde storniert`,
      message: snippetHtml,
      includeQRCode: false,
      attachments,
      sendBCC: false,
      addRejectionLink: false,
    });
  }

  static async sendVerifyBookingRejection(
    address,
    bookingId,
    tenantId,
    hookId,
    reason,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);

    const verifyRejectionUrl = `${process.env.FRONTEND_URL}/booking/verify-reject/${tenantId}?id=${bookingId}&hookId=${hookId}`;

    const snippetTemplateString = `
    <p>Für die nachfolgende Buchung wurde eine Stornierung vorgemerkt. Wenn Sie diese Stornierung bestätigen möchten, klicken Sie bitte auf den nachfolgenden Button.</p>    
    <p>Sollten Sie die Stornierung nicht veranlasst haben, können Sie diese Nachricht ignorieren.</p>
    {{#if cancelReason}}
      <p><strong>Hinweis zur Stornierung</strong>: {{sanitizeString  cancelReason}} </p>
    {{/if}}
    <p>
      <a href="${verifyRejectionUrl}"
         style="
           background-color: #0055a5;
           color: #ffffff;
           padding: 12px 24px;
           border-radius: 4px;
           text-decoration: none;
           font-weight: bold;
           display: inline-block;">
        Stornierung bestätigen
      </a>
    </p>
  `;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      cancelReason: reason,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Stornierungsanfrage für Ihre Buchung im ${tenant.name}`,
      title: `Stornierungsanfrage für Ihre Buchung im ${tenant.name}`,
      message: snippetHtml,
      includeQRCode: false,
      attachments,
      sendBCC: false,
      addRejectionLink: false,
    });
  }

  static async sendFreeBookingConfirmation(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    const includeQRCode = tenant.enablePublicStatusView;

    const snippetTemplateString = `
    <div style="font-family: sans-serif;">
      <p>
        Hallo,<br>
        vielen Dank für Ihre kostenfreie Buchung im <strong>{{tenantName}}</strong>.
      </p>

      <p>
        Wir haben Ihre Buchung erhalten und senden Ihnen nachfolgend alle wichtigen Details.
        Bei Rückfragen erreichen Sie uns gern unter 
        <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.
      </p>
    </div>
  `;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      tenantName: tenant.name,
      supportEmail: tenant.mail,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      title: `Vielen Dank für Ihre Buchung im ${tenant.name}`,
      message: snippetHtml,
      includeQRCode: includeQRCode,
      attachments: undefined,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendBookingRequestConfirmation(address, bookingId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);

    const includeQRCode = tenant.enablePublicStatusView;

    const snippetTemplateString = `
    <div style="font-family: sans-serif;">
      <p>
        Hallo,<br>
        vielen Dank für Ihre Buchungsanfrage im 
        <strong>{{tenantName}}</strong>.
      </p>
      
      <p>
        Wir haben Ihre Anfrage erhalten und bearbeiten diese schnellstmöglich.
        Sie erhalten in Kürze weitere Informationen von uns.
      </p>
      
      <p style="margin-top: 20px;">
        Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.
      </p>
    </div>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      tenantName: tenant.name,
      supportEmail: tenant.mail,
    });

    await this._sendBookingMail({
      address: address,
      bookingId: bookingId,
      tenantId: tenantId,
      subject: `Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}`,
      title: `Vielen Dank für Ihre Buchungsanfrage im ${tenant.name}`,
      message: snippetHtml,
      includeQRCode: includeQRCode,
      attachments: undefined,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendInvoice(
    address,
    bookingId,
    tenantId,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);
    const includeQRCode = tenant.enablePublicStatusView;

    const snippetTemplateString = `
        <p>
          Hallo,<br>
          vielen Dank für Ihre Buchung bei <strong>{{tenantName}}</strong>.
        </p>
        
        <p>
          Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den im Anhang 
          aufgeführten Betrag auf das angegebene Konto.
        </p>
  
        <p style="margin-top: 20px;">
          Falls Sie Fragen haben, können Sie uns gerne 
          <a href="mailto:{{supportEmail}}">kontaktieren</a>.
        </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      tenantName: tenant.name,
      supportEmail: tenant.mail,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Rechnung zu Ihrer Buchung bei ${tenant.name}`,
      title: `Rechnung zu Ihrer Buchung bei ${tenant.name}`,
      message: snippetHtml,
      includeQRCode: includeQRCode,
      attachments,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendPaymentLinkAfterBookingApproval(
    address,
    bookingId,
    tenantId,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);
    const paymentLink = `${process.env.FRONTEND_URL}/payment/redirection?id=${bookingId}&tenant=${tenantId}`;
    const includeQRCode = tenant.enablePublicStatusView;

    const snippetTemplateString = `
          <p>
            Vielen Dank für Ihre Buchungsanfrage im
            <strong>{{tenantName}}</strong>.
            Wir haben diese erfolgreich geprüft und freigegeben.
          </p>
    
          <p>
            Bitte nutzen Sie den folgenden Button, um Ihre Buchung abzuschließen:
          </p>
    
          <p>
            <a href="{{paymentUrl}}"
               style="
                 background-color: #0055a5;
                 color: #ffffff;
                 padding: 12px 24px;
                 border-radius: 4px;
                 text-decoration: none;
                 font-weight: bold;
                 display: inline-block;">
              Buchung abschließen
            </a>
          </p>
    
          <p style="margin-top: 20px;">
            Sollten Sie weitere Fragen haben, können Sie uns jederzeit 
            <a href="mailto:{{supportEmail}}">kontaktieren</a>.
          </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      tenantName: tenant.name,
      paymentUrl: paymentLink,
      supportEmail: tenant.mail,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
      title: `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
      message: snippetHtml,
      includeQRCode: includeQRCode,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendInvoiceAfterBookingApproval(
    address,
    bookingId,
    tenantId,
    attachments = undefined,
  ) {
    const tenant = await TenantManager.getTenant(tenantId);
    const includeQRCode = tenant.enablePublicStatusView;

    const snippetTemplateString = `
      <p>
        Vielen Dank für Ihre Buchungsanfrage im 
        <strong>{{tenantName}}</strong>. Wir haben diese 
        erfolgreich geprüft und freigegeben.
      </p>
      
      <p>
        Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den 
        im Anhang aufgeführten Betrag auf das angegebene Konto.
      </p>

      <p style="margin-top: 20px;">
        Sollten Sie Fragen haben, stehen wir Ihnen gerne unter 
        <a href="mailto:{{supportEmail}}">{{supportEmail}}</a> 
        zur Verfügung.
      </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      tenantName: tenant.name,
      supportEmail: tenant.mail,
    });

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
      title: `Bitte schließen Sie Ihre Buchung im ${tenant.name} ab`,
      message: snippetHtml,
      includeQRCode: includeQRCode,
      attachments,
      sendBCC: false,
      addRejectionLink: true,
    });
  }

  static async sendPaymentRequest(
    address,
    bookingId,
    tenantId,
    attachments = undefined,
  ) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);

      if (!booking) {
        throw new Error("Booking not found");
      }

      const paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        bookingId,
        booking.paymentProvider,
        attachments,
      );

      if (!paymentService) return;

      await paymentService.paymentRequest();
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  static async sendIncomingBooking(address, bookingId, tenantId) {
    const snippetTemplateString = `
        <p>Es liegt eine neue Buchungsanfrage vor.</p>`;

    const snippetHtml = renderSnippet(snippetTemplateString);

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: `Eine neue Buchungsanfrage liegt vor`,
      title: `Eine neue Buchungsanfrage liegt vor`,
      message: snippetHtml,
      sendBCC: false,
      addRejectionLink: false,
    });
  }

  static async sendNewBooking(address, bookingId, tenantId) {
    const message = `<p>Es liegt eine neue Buchung vor.</p><br>`;

    await this._sendBookingMail({
      address,
      bookingId,
      tenantId,
      subject: "Eine neue Buchung liegt vor",
      title: "Eine neue Buchung liegt vor",
      message,
      sendBCC: false,
    });
  }

  static async sendNewGroupBooking(
    address,
    groupBookingId,
    bookingIds,
    tenantId,
  ) {
    const message = `<p>Es liegt eine neue Buchung vor.</p><br>`;
  }

  static async sendVerificationRequest(address, hookId) {
    const verifyUrl = `${process.env.BACKEND_URL}/auth/verify/${hookId}`;

    const snippetTemplateString = `
        <p>
          Um Ihre E-Mail-Adresse zu bestätigen, klicken Sie bitte auf den folgenden Button.
        </p>
        <p style="text-align: center;">
          <a href="{{verifyUrl}}"
             style="
               background-color: #0055a5;
               color: #ffffff;
               padding: 12px 24px;
               border-radius: 4px;
               text-decoration: none;
               font-weight: bold;
               display: inline-block;">
            E-Mail bestätigen
          </a>
        </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      verifyUrl,
    });

    const instance = await InstanceManager.getInstance(false);

    await MailerService.send({
      address,
      subject: "Bestätigen Sie Ihre E-Mail-Adresse",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Bestätigen Sie Ihre E-Mail-Adresse",
        content: snippetHtml,
      },
    });
  }

  static async sendPasswordResetRequest(address, hookId) {
    const resetUrl = `${process.env.BACKEND_URL}/auth/reset/${hookId}`;

    const snippetTemplateString = `
        <p>
          Ihr Kennwort wurde geändert. Um die Änderung zu bestätigen, klicken Sie bitte auf den nachfolgenden Button.<br>
          Falls Sie keine Änderung an Ihrem Kennwort vorgenommen haben, können Sie diese Nachricht ignorieren.
        </p>
        <p style="text-align: center;">
          <a href="{{resetUrl}}"
             style="
               background-color: #0055a5;
               color: #ffffff;
               padding: 12px 24px;
               border-radius: 4px;
               text-decoration: none;
               font-weight: bold;
               display: inline-block;">
            Kennwortänderung bestätigen
          </a>
        </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, { resetUrl });

    const instance = await InstanceManager.getInstance(false);

    await MailerService.send({
      address,
      subject: "Bestätigen Sie die Änderung Ihres Kennworts",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Bestätigen Sie die Änderung Ihres Kennworts",
        content: snippetHtml,
      },
    });
  }

  static async sendUserCreated(userId) {
    const instance = await InstanceManager.getInstance(false);
    const user = await UserManager.getUser(userId);

    const snippetTemplateString = `
        <p>Ein neuer Benutzer wurde erstellt.</p>
        <br />
        <p><strong>Vorname:</strong> {{firstName}}</p>
        <p><strong>Nachname:</strong> {{lastName}}</p>
        {{#if company}}
          <p><strong>Firma:</strong> {{company}}</p>
        {{/if}}
        <p><strong>E-Mail:</strong> {{email}}</p>
        <br />
        <p>
          <strong>Registrierungsdatum:</strong> {{formatDateTime createDate}}
        </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      email: user.id,
      createDate: user.created,
    });

    await MailerService.send({
      address: instance.mailAddress,
      subject: "Ein neuer Benutzer wurde erstellt",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Ein neuer Benutzer wurde erstellt",
        content: snippetHtml,
      },
    });
  }

  static async sendWorkflowNotification({
    sendTo,
    tenantId,
    bookingId,
    oldStatus,
    newStatus,
  }) {
    const tenant = await TenantManager.getTenant(tenantId);

    const snippetTemplateString = `
        <p>Guten Tag,</p>
  
        <p>
          bitte beachten Sie, dass sich der Status der folgenden Buchung geändert hat:
        </p>
  
        <ul style="list-style-type: none; padding-left: 0;">
          <li><strong>Buchungsnummer:</strong> {{bookingId}}</li>
          <li><strong>Mandant:</strong> {{tenantName}}</li>
          <li><strong>Alter Status:</strong> {{oldStatus}}</li>
          <li><strong>Neuer Status:</strong> {{newStatus}}</li>
        </ul>
  
        <p>
          Aufgrund dieser Änderung ist ggf. eine Prüfung oder 
          weitere Bearbeitung erforderlich.
        </p>`;

    const snippetHtml = renderSnippet(snippetTemplateString, {
      bookingId,
      tenantName: tenant.name,
      oldStatus,
      newStatus,
    });

    await MailerService.send({
      address: sendTo,
      subject: `Änderung bei der Buchung Nr. ${bookingId} - Neuer Status`,
      mailTemplate: tenant.genericMailTemplate,
      model: {
        title: `Änderung bei der Buchung Nr. ${bookingId} - Neuer Status`,
        content: snippetHtml,
      },
      useInstanceMail: tenant.useInstanceMail,
    });
  }
}

module.exports = MailController;

function renderSnippet(htmlSnippet, data) {
  const wrappedTemplateString = `
    <div style="font-family: sans-serif;">
      ${htmlSnippet}
    </div>
  `;

  const template = Handlebars.compile(wrappedTemplateString);

  return template(data);
}
