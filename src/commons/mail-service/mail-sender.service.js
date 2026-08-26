const Handlebars = require("handlebars");
const MailerService = require("./mail-service");
const TenantManager = require("../data-managers/tenant-manager");
const BookingManager = require("../data-managers/booking-manager");
const MailDataService = require("./mail-data.service");
const { renderSnippet } = require("./templates/template-loader");
const {
  getSnippetOverride,
  getSubjectOverride,
  renderSubjectOverride,
  afterSnippetKey,
} = require("./templates/mail-snippet-overrides");

const overrideDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function escapeHtml(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCustomerContactHtml(booking) {
  if (!booking) return "";

  const lines = [];
  if (booking.name) {
    lines.push(`<strong>Name:</strong> ${escapeHtml(booking.name)}`);
  }
  if (booking.company) {
    lines.push(`<strong>Firma:</strong> ${escapeHtml(booking.company)}`);
  }
  if (booking.mail) {
    lines.push(`<strong>E-Mail:</strong> ${escapeHtml(booking.mail)}`);
  }
  if (booking.phone) {
    lines.push(`<strong>Telefon:</strong> ${escapeHtml(booking.phone)}`);
  }

  const cityLine = [booking.zipCode, booking.location]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" ");
  const addressParts = [];
  if (booking.street) addressParts.push(escapeHtml(booking.street));
  if (cityLine) addressParts.push(cityLine);
  if (addressParts.length) {
    lines.push(`<strong>Adresse:</strong> ${addressParts.join(", ")}`);
  }

  return lines.join("<br />");
}

function buildOverrideTemplateVariables({ tenant, booking, extra = {} }) {
  const customerContactHtml = buildCustomerContactHtml(booking);
  return {
    tenantName: tenant?.name ?? "",
    supportEmail: tenant?.mail ?? "",
    customerName: booking?.name ?? "",
    customerContact: customerContactHtml
      ? new Handlebars.SafeString(customerContactHtml)
      : "",
    currentDate: overrideDateFormatter.format(new Date()),
    ...extra,
  };
}

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
    message,
    messageAfter = "",
    includeQRCode = false,
    attachments = [],
    sendBCC = false,
    addRejectionLink = false,
    paymentUrl = null,
    cancelReason = null,
    rejectionReason = null,
  }) {
    const tenant = await TenantManager.getTenant(tenantId);

    const booking = bookingId
      ? await BookingManager.getBooking(bookingId, tenantId)
      : null;

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

    const { rejectionUrl, cancellationContactHint } =
      MailDataService.buildCancellationMailContext(
        booking,
        tenantId,
        addRejectionLink,
      );

    const snippetHtml = renderSnippet("single-booking-wrapper", {
      message,
      paymentUrl,
      cancelReason,
      rejectionReason,
      bookingDetails,
      rejectionUrl,
      cancellationContactHint,
      qrContent,
      showFooter: tenant.mailShowSupportFooter !== false,
      supportEmail: tenant.mail,
      messageAfter,
    });

    await MailerService.send({
      tenantId,
      address,
      subject,
      mailTemplate: tenant.genericMailTemplate,
      model: { content: snippetHtml },
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
    message,
    messageAfter = "",
    attachments = [],
    sendBCC = false,
    addRejectionLink = false,
    paymentUrl = null,
    cancelReason = null,
    rejectionReason = null,
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
      paymentUrl,
      cancelReason,
      rejectionReason,
      bookingDetails,
      showFooter: tenant.mailShowSupportFooter !== false,
      supportEmail: tenant.mail,
      messageAfter,
    });

    await MailerService.send({
      tenantId,
      address,
      subject,
      mailTemplate: tenant.genericMailTemplate,
      model: { content: snippetHtml },
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

    const defaultSubject = this.resolve(mailType.subject, ctx);
    const subjectOverrideSource = getSubjectOverride(
      tenant,
      mailType.templateName,
    );

    const includeQRCode = this.resolve(mailType.includeQRCode, ctx);
    const sendBCC = this.resolve(mailType.sendBCC, ctx);
    const addRejectionLink = this.resolve(mailType.addRejectionLink, ctx);
    const overrideSource = getSnippetOverride(tenant, mailType.templateName);
    const afterOverrideSource = getSnippetOverride(
      tenant,
      afterSnippetKey(mailType.templateName),
    );
    const {
      paymentUrl,
      cancelReason,
      rejectionReason,
      verifyRejectionUrl,
      hasRefundPreview,
      originalAmountEur,
      refundAmountEur,
      cancellationFeeEur,
      refundPercentage,
      daysBeforeStart,
      hasCancellationFee,
    } = templateData;

    const renderForBooking = (booking) => {
      const refundVars =
        typeof hasRefundPreview === "boolean"
          ? {
              hasRefundPreview,
              originalAmountEur,
              refundAmountEur,
              cancellationFeeEur,
              refundPercentage,
              daysBeforeStart,
              hasCancellationFee,
            }
          : {};

      const variables = buildOverrideTemplateVariables({
        tenant,
        booking,
        extra: {
          verifyRejectionUrl,
          cancelReason,
          rejectionReason,
          ...refundVars,
        },
      });

      const message = renderSnippet(mailType.templateName, variables, {
        overrideSource,
      });

      const messageAfter = afterOverrideSource
        ? renderSnippet(afterSnippetKey(mailType.templateName), variables, {
            overrideSource: afterOverrideSource,
          })
        : "";

      const subject = subjectOverrideSource
        ? renderSubjectOverride(subjectOverrideSource, variables)
        : defaultSubject;

      return { message, messageAfter, subject };
    };

    if (aggregated) {
      const primaryBookingId = bookingIds[0];
      const primaryBooking = primaryBookingId
        ? await BookingManager.getBooking(primaryBookingId, tenantId)
        : null;
      const { message, messageAfter, subject } =
        renderForBooking(primaryBooking);

      await this.sendAggregatedBookingMail({
        address,
        bookingIds,
        tenantId,
        subject,
        message,
        messageAfter,
        attachments,
        sendBCC,
        addRejectionLink,
        paymentUrl,
        cancelReason,
        rejectionReason,
      });
    } else {
      for (const bookingId of bookingIds) {
        const booking = bookingId
          ? await BookingManager.getBooking(bookingId, tenantId)
          : null;
        const { message, messageAfter, subject } = renderForBooking(booking);

        await this.sendBookingMail({
          address,
          bookingId,
          tenantId,
          subject,
          message,
          messageAfter,
          includeQRCode,
          attachments,
          sendBCC,
          addRejectionLink,
          paymentUrl,
          cancelReason,
          rejectionReason,
        });
      }
    }
  }
}

module.exports = MailSenderService;
