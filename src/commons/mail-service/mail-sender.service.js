const MailerService = require("./mail-service");
const TenantManager = require("../data-managers/tenant-manager");
const ICalService = require("../services/ical-service");
const MailDataService = require("./mail-data.service");
const { renderSnippet } = require("./templates/template-loader");

class MailSenderService {
  /**
   * Universal booking mail sender.
   * Handles single bookings, loops, and aggregated mails.
   */
  static async sendBookingMail({
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

    // Booking details
    const bookingDetails = bookingId
      ? await MailDataService.generateBookingDetails(bookingId, tenantId)
      : "";

    // QR code
    let qrContent = "";
    if (includeQRCode) {
      const qrResult = await MailDataService.generateQRCode(
        bookingId,
        tenantId,
      );
      qrContent = qrResult.content;
      attachments = [...attachments, qrResult.attachment];
    }

    // Rejection link
    const rejectionUrl = addRejectionLink
      ? `${process.env.FRONTEND_URL}/booking/request-reject/${tenantId}?id=${bookingId}`
      : null;

    const snippetHtml = renderSnippet("single-booking-wrapper", {
      message,
      bookingDetails,
      rejectionUrl,
      qrContent,
      showFooter: true,
      supportEmail: tenant.mail,
    });

    await MailerService.send({
      tenantId,
      address,
      subject,
      mailTemplate: tenant.genericMailTemplate,
      model: { title, content: snippetHtml },
      attachments,
      bcc: sendBCC ? tenant.mail : undefined,
      useInstanceMail: tenant.useInstanceMail,
    });
  }

  static async sendAggregatedBookingMail({
    address,
    bookingIds,
    tenantId,
    subject,
    title,
    message,
    attachments = [],
    sendBCC = false,
    addRejectionLink = false,
  }) {
    const tenant = await TenantManager.getTenant(tenantId);

    const bookingDetails =
      await MailDataService.generateAggregatedBookingDetails(
        tenantId,
        bookingIds,
        addRejectionLink,
      );

    const snippetHtml = renderSnippet("aggregated-booking-wrapper", {
      message,
      bookingDetails,
      showFooter: true,
      supportEmail: tenant.mail,
    });

    await MailerService.send({
      tenantId,
      address,
      subject,
      mailTemplate: tenant.genericMailTemplate,
      model: { title, content: snippetHtml },
      attachments,
      bcc: sendBCC ? tenant.mail : undefined,
      useInstanceMail: tenant.useInstanceMail,
    });
  }

  /**
   * Resolves a MailType config value – can be a static value or
   * a function of the context.
   */
  static resolve(valueOrFn, ctx) {
    return typeof valueOrFn === "function" ? valueOrFn(ctx) : valueOrFn;
  }

  /**
   * The main generic dispatch method.
   * Replaces all the individual send* methods on the old controller.
   */
  static async dispatch({
    mailType,
    address,
    bookingIds,
    tenantId,
    templateData = {},
    attachments = [],
    aggregated = false,
  }) {
    bookingIds = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    const tenant = await TenantManager.getTenant(tenantId);

    const ctx = {
      tenant,
      hasAttachments: attachments?.length > 0,
    };

    const subject = this.resolve(mailType.subject, ctx);
    const title = this.resolve(mailType.title, ctx);
    const includeQRCode = this.resolve(mailType.includeQRCode, ctx);
    const sendBCC = this.resolve(mailType.sendBCC, ctx);
    const addRejectionLink = this.resolve(mailType.addRejectionLink, ctx);

    const message = renderSnippet(mailType.templateName, {
      tenantName: tenant.name,
      supportEmail: tenant.mail,
      ...templateData,
    });

    if (aggregated) {
      await this.sendAggregatedBookingMail({
        address,
        bookingIds,
        tenantId,
        subject,
        title,
        message,
        attachments,
        sendBCC,
        addRejectionLink,
      });
    } else {
      for (const bookingId of bookingIds) {
        await this.sendBookingMail({
          address,
          bookingId,
          tenantId,
          subject,
          title,
          message,
          includeQRCode,
          attachments,
          sendBCC,
          addRejectionLink,
        });
      }
    }
  }
}

module.exports = MailSenderService;
