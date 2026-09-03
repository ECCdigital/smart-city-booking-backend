/**
 * The registry of the notice types (glossary "Mitteilungsart"; mail-stack
 * spec, section 2.2): for each type, who gets it, which snippet it
 * carries, how its subject reads and what is attached. The registry only
 * describes - composing is `compose`, sending is `send`.
 *
 * Fields:
 * - `family`: the context the loader builds - `booking` (a tenant, its
 *   bookings, their bookables and events), `tenant` (the tenant, whose
 *   shell template the notice goes out in) or `instance` (the instance,
 *   and the user `ctx.userId` names).
 * - `templateName`: the snippet, and the key of the tenant's overrides.
 * - `audience`: the recipients (glossary "Empfängerkreis") - `booker`,
 *   `tenant`, `supervisors`, `organizers`, `instanceAdmin` (the instance's
 *   address) or `named` (`ctx.to`).
 * - `subject(ctx)`: the default subject; a subject override of the
 *   tenant takes precedence.
 * - `includeQRCode(ctx)`, `sendBCC(ctx)`, `addRejectionLink`: as before.
 * - `attachICal`: the calendar file of the bookings goes with it.
 * - `mergeMailAttach`: the `mailAttach` documents of the bookings go
 *   with it.
 * - `gate({ tenant })`: the audience only gets it where this holds.
 * - `templateData(ctx, loaded)`: the type's own template variables from
 *   the caller's context and what the loader read.
 *
 * Of a booking notice, `ctx` of `subject`, `includeQRCode` and `sendBCC`
 * is `{ tenant, hasAttachments }`, and `templateData` gets the
 * type-specific part of the caller's context and the loaded bookings.
 * `includeQRCode`, `sendBCC`, `addRejectionLink`, `attachICal`,
 * `mergeMailAttach` and `gate` are of the booking family only.
 *
 * Of a tenant or instance notice (the account mails, the invitation, the
 * workflow notification), `templateData` gets the whole context and
 * `{ tenant, instance, user }`, and `subject` gets `{ tenant }` joined by
 * the template data. The links these notices carry are built here: the
 * storefront's route where the caller names one, the backend's own
 * otherwise.
 */

const {
  CancellationRefundService,
} = require("../services/payment/cancellation-refund-service");

/** A storefront route with the hook's token and the address it is for. */
function hookLink(base, hookId, address) {
  return `${base}?token=${hookId}&id=${encodeURIComponent(address)}`;
}

const MailType = Object.freeze({
  BOOKING_CONFIRMATION: {
    family: "booking",
    templateName: "booking-confirmation",
    audience: "booker",
    subject: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: (ctx) => ctx.hasAttachments && ctx.tenant.receiptEnableBCC,
    addRejectionLink: true,
    attachICal: true,
    mergeMailAttach: true,
  },

  FREE_BOOKING_CONFIRMATION: {
    family: "booking",
    templateName: "free-booking-confirmation",
    audience: "booker",
    subject: (ctx) => `Vielen Dank für Ihre Buchung im  ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
    attachICal: true,
    mergeMailAttach: true,
  },

  BOOKING_REJECTION: {
    family: "booking",
    templateName: "booking-rejection",
    audience: "booker",
    subject: (ctx) =>
      `Abgelehnt: Ihre Buchungsanfrage im ${ctx.tenant.name} wurde abgelehnt`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
    templateData: ({ reason }) => ({ rejectionReason: reason }),
  },

  BOOKING_CANCEL: {
    family: "booking",
    templateName: "booking-cancel",
    audience: "booker",
    subject: (ctx) =>
      `Stornierung: Ihre Buchung im ${ctx.tenant.name} wurde storniert`,
    includeQRCode: false,
    sendBCC: true,
    addRejectionLink: false,
    // The refund is the one recorded at the first booking.
    templateData: ({ reason }, { bookings }) => ({
      cancelReason: reason,
      ...CancellationRefundService.toMailTemplateData(
        bookings[0].cancellationRefund,
      ),
    }),
  },

  BOOKING_REQUEST_CONFIRMATION: {
    family: "booking",
    templateName: "booking-request-confirmation",
    audience: "booker",
    subject: (ctx) =>
      `Vielen Dank für Ihre Buchungsanfrage im ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
    mergeMailAttach: true,
  },

  INVOICE: {
    family: "booking",
    templateName: "invoice",
    audience: "booker",
    subject: (ctx) => `Rechnung zu Ihrer Buchung bei ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
  },

  BOOKING_CONFIRMED_INVOICE_PENDING: {
    family: "booking",
    templateName: "booking-confirmed-invoice-pending",
    audience: "booker",
    subject: (ctx) => `Buchungsbestätigung - ${ctx.tenant.name}`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
    attachICal: true,
  },

  PAYMENT_LINK_AFTER_APPROVAL: {
    family: "booking",
    templateName: "payment-link-after-approval",
    audience: "booker",
    subject: (ctx) =>
      `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: true,
    templateData: ({ paymentUrl }) => ({ paymentUrl }),
  },

  INVOICE_AFTER_APPROVAL: {
    family: "booking",
    templateName: "invoice-after-approval",
    audience: "booker",
    subject: (ctx) =>
      `Bitte schließen Sie Ihre Buchung im ${ctx.tenant.name} ab`,
    includeQRCode: (ctx) => ctx.tenant.enablePublicStatusView,
    sendBCC: false,
    addRejectionLink: false,
  },

  INCOMING_BOOKING: {
    family: "booking",
    templateName: "incoming-booking",
    audience: "tenant",
    subject: () => "Eine neue Buchungsanfrage liegt vor",
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
    gate: (ctx) => Boolean(ctx.tenant.notifyOnNewBooking),
  },

  NEW_BOOKING: {
    family: "booking",
    templateName: "new-booking",
    audience: "organizers",
    subject: () => "Eine neue Buchung liegt vor",
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },

  SUPERVISOR_BOOKING_NOTIFICATION: {
    family: "booking",
    templateName: "supervisor-booking-notification",
    audience: "supervisors",
    subject: (ctx) => `Neue Buchung im ${ctx.tenant.name}`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
  },

  VERIFY_BOOKING_REJECTION: {
    family: "booking",
    templateName: "verify-rejection",
    audience: "booker",
    subject: (ctx) =>
      `Stornierungsanfrage für Ihre Buchung im ${ctx.tenant.name}`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
    templateData: ({ reason, hookId, refundPreview = null }, loaded) => ({
      cancelReason: reason,
      verifyRejectionUrl: `${process.env.FRONTEND_URL}/booking/verify-reject/${loaded.tenantId}?id=${loaded.bookings[0].id}&hookId=${hookId}`,
      ...CancellationRefundService.toMailTemplateData(refundPreview),
    }),
  },

  ACCESS_PROVISIONED: {
    family: "booking",
    templateName: "access-provisioned",
    audience: "booker",
    subject: (ctx) => `Zugangsdaten zu Ihrer Buchung im ${ctx.tenant.name}`,
    includeQRCode: false,
    sendBCC: false,
    addRejectionLink: false,
    templateData: ({ accessPoints }) => ({ accessPoints }),
  },

  WORKFLOW_NOTIFICATION: {
    family: "tenant",
    templateName: "workflow-notification",
    audience: "named",
    subject: (ctx) =>
      `Änderung bei der Buchung Nr. ${ctx.bookingId} - Neuer Status`,
    templateData: ({ bookingIds, oldStatus, newStatus }, { tenant }) => ({
      bookingId: bookingIds[0],
      tenantName: tenant.name,
      oldStatus,
      newStatus,
    }),
  },

  INVITATION: {
    family: "tenant",
    templateName: "invitation",
    audience: "named",
    subject: (ctx) => `Biletado - Einladung zum ${ctx.tenant.name} Mandanten`,
    templateData: ({ tenantId, token }, { tenant }) => ({
      tenantName: tenant.name,
      invitationUrl: `${process.env.FRONTEND_URL}/auth/invitation/${tenantId}?token=${token}`,
      supportEmail: tenant.mail,
    }),
  },

  VERIFICATION_REQUEST: {
    family: "instance",
    templateName: "verification-request",
    audience: "named",
    subject: () => "Bestätigen Sie Ihre E-Mail-Adresse",
    templateData: ({ to, hookId, verifyUrl }) => ({
      verifyUrl: verifyUrl
        ? hookLink(verifyUrl, hookId, to)
        : `${process.env.BACKEND_URL}/auth/verify/${hookId}`,
    }),
  },

  PASSWORD_RESET: {
    family: "instance",
    templateName: "password-reset",
    audience: "named",
    subject: () => "Bestätigen Sie die Änderung Ihres Kennworts",
    templateData: ({ hookId }) => ({
      resetUrl: `${process.env.BACKEND_URL}/auth/reset/${hookId}`,
    }),
  },

  FORGOT_PASSWORD_REQUEST: {
    family: "instance",
    templateName: "forgot-password-request",
    audience: "named",
    subject: () => "Kennwort zurücksetzen",
    templateData: ({ to, hookId, resetUrl }) => ({
      resetUrl: hookLink(
        resetUrl || `${process.env.FRONTEND_URL}/password/reset`,
        hookId,
        to,
      ),
    }),
  },

  USER_CREATED: {
    family: "instance",
    templateName: "user-created",
    audience: "instanceAdmin",
    subject: () => "Ein neuer Benutzer wurde erstellt",
    templateData: (ctx, { user }) => ({
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      email: user.id,
      createDate: user.created,
    }),
  },

  CARD_LINK_REQUEST: {
    family: "instance",
    templateName: "card-link-request",
    audience: "named",
    subject: () => "Karte mit Ihrem Account verknüpfen",
    templateData: ({ to, firstName, hookId, cardLabel, linkUrlBase }) => ({
      email: to,
      firstName,
      cardLabel,
      linkUrl: hookLink(
        linkUrlBase || `${process.env.BACKEND_URL}/auth/card/link`,
        hookId,
        to,
      ),
    }),
  },
});

module.exports = { MailType };
