/**
 * Declarative registry of every mail type the system can send.
 *
 * Each entry describes *what* data a mail needs and how to derive
 * subject / title from it.  The actual rendering + sending is
 * handled generically by MailSenderService.
 */
const MailType = Object.freeze({
  BOOKING_CONFIRMATION: {
    templateName: "booking-confirmation",
    subject: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    title: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: (ctx) => ctx.hasAttachments && ctx.tenant.receiptEnableBCC,
    addRejectionLink: true,
  },

  FREE_BOOKING_CONFIRMATION: {
    templateName: "free-booking-confirmation",
    subject: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    title: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
  },

  BOOKING_REJECTION: {
    templateName: "booking-rejection",
    subject: (ctx) =>
      `Abgelehnt: Ihre Buchungsanfrage im ${ctx.tenant.name} wurde abgelehnt`,
    title: (ctx) =>
      `Ihre Buchungsanfrage im ${ctx.tenant.name} wurde abgelehnt`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },

  BOOKING_CANCEL: {
    templateName: "booking-cancel",
    subject: (ctx) =>
      `Stornierung: Ihre Buchung im ${ctx.tenant.name} wurde storniert`,
    title: (ctx) => `Ihre Buchung im ${ctx.tenant.name} wurde storniert`,
    includeQRCode: false,
    sendBCC: true,
    addRejectionLink: false,
  },

  BOOKING_REQUEST_CONFIRMATION: {
    templateName: "booking-request-confirmation",
    subject: (ctx) =>
      `Vielen Dank für Ihre Buchungsanfrage im ${ctx.tenant.name}`,
    title: (ctx) =>
      `Vielen Dank für Ihre Buchungsanfrage im ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
  },

  INVOICE: {
    templateName: "invoice",
    subject: (ctx) => `Rechnung zu Ihrer Buchung bei ${ctx.tenant.name}`,
    title: (ctx) => `Rechnung zu Ihrer Buchung bei ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
  },

  PAYMENT_LINK_AFTER_APPROVAL: {
    templateName: "payment-link-after-approval",
    subject: (ctx) =>
      `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    title: (ctx) => `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
    // This type needs per-booking payment URLs → handled via extra context
    perBookingContext: true,
  },

  INVOICE_AFTER_APPROVAL: {
    templateName: "invoice-after-approval",
    subject: (ctx) =>
      `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    title: (ctx) => `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: false,
  },

  INCOMING_BOOKING: {
    templateName: "incoming-booking",
    subject: () => "Eine neue Buchungsanfrage liegt vor",
    title: () => "Eine neue Buchungsanfrage liegt vor",
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },

  NEW_BOOKING: {
    templateName: "new-booking",
    subject: () => "Eine neue Buchung liegt vor",
    title: () => "Eine neue Buchung liegt vor",
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },

  VERIFY_BOOKING_REJECTION: {
    templateName: "verify-rejection",
    subject: (ctx) =>
      `Stornierungsanfrage für Ihre Buchung im ${ctx.tenant.name}`,
    title: (ctx) =>
      `Stornierungsanfrage für Ihre Buchung im ${ctx.tenant.name}`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },
});

module.exports = { MailType };
