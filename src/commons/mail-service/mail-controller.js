const MailSenderService = require("./mail-sender.service");
const MailerService = require("./mail-service");
const TenantManager = require("../data-managers/tenant-manager");
const BookingManager = require("../data-managers/booking-manager");
const InstanceManager = require("../data-managers/instance-manager");
const UserManager = require("../data-managers/user-manager");
const { MailType } = require("./mail-types");
const { renderSnippet } = require("./templates/template-loader");
const ICalService = require("../services/ical-service");
const {
  CancellationRefundService,
} = require("../services/payment/cancellation-refund-service");

class MailController {
  static async _attachICalFiles(bookingIds, tenantId, attachments = []) {
    try {
      if (typeof bookingIds === "string") {
        bookingIds = [bookingIds];
      }

      if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
        return attachments;
      }

      const isSingle = bookingIds.length === 1;
      const cal = isSingle
        ? await ICalService.getBookingCal(bookingIds[0], tenantId)
        : await ICalService.getMultiBookingCal(bookingIds, tenantId);

      if (!cal) return attachments;

      return [
        ...attachments,
        {
          filename: isSingle ? `buchung-${bookingIds[0]}.ics` : "buchungen.ics",
          content: Buffer.from(cal.toString(), "utf-8"),
          contentType: "text/calendar; charset=UTF-8; method=PUBLISH",
        },
      ];
    } catch (err) {
      console.warn(err.message);
      return attachments;
    }
  }

  static async sendBookingConfirmation(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    attachments = await this._attachICalFiles(
      bookingIds,
      tenantId,
      attachments,
    );

    await MailSenderService.dispatch({
      mailType: MailType.BOOKING_CONFIRMATION,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendFreeBookingConfirmation(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    attachments = await this._attachICalFiles(
      bookingIds,
      tenantId,
      attachments,
    );

    await MailSenderService.dispatch({
      mailType: MailType.FREE_BOOKING_CONFIRMATION,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendBookingRejection(
    address,
    bookingIds,
    tenantId,
    reason,
    attachments,
    aggregated = false,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.BOOKING_REJECTION,
      address,
      bookingIds,
      tenantId,
      templateData: { rejectionReason: reason },
      attachments,
      aggregated,
    });
  }

  static async sendBookingCancel(
    address,
    bookingIds,
    tenantId,
    reason,
    attachments,
    aggregated = false,
  ) {
    const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    const primaryBookingId = ids[0];
    let refundTemplateData = {};
    if (primaryBookingId) {
      const booking = await BookingManager.getBooking(
        primaryBookingId,
        tenantId,
      );
      refundTemplateData = CancellationRefundService.toMailTemplateData(
        booking?.cancellationRefund,
      );
    }

    await MailSenderService.dispatch({
      mailType: MailType.BOOKING_CANCEL,
      address,
      bookingIds,
      tenantId,
      templateData: { cancelReason: reason, ...refundTemplateData },
      attachments,
      aggregated,
    });
  }

  static async sendBookingRequestConfirmation(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
    attachments = [],
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.BOOKING_REQUEST_CONFIRMATION,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendInvoice(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.INVOICE,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendBookingConfirmedInvoicePending(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    const attachments = await this._attachICalFiles(bookingIds, tenantId);

    await MailSenderService.dispatch({
      mailType: MailType.BOOKING_CONFIRMED_INVOICE_PENDING,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendInvoiceAfterBookingApproval(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.INVOICE_AFTER_APPROVAL,
      address,
      bookingIds,
      tenantId,
      attachments,
      aggregated,
    });
  }

  static async sendIncomingBooking(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.INCOMING_BOOKING,
      address,
      bookingIds,
      tenantId,
      aggregated,
    });
  }

  static async sendSupervisorBookingNotification(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.SUPERVISOR_BOOKING_NOTIFICATION,
      address,
      bookingIds,
      tenantId,
      aggregated,
    });
  }

  static async sendNewBooking(address, bookingId, tenantId) {
    await MailSenderService.dispatch({
      mailType: MailType.NEW_BOOKING,
      address,
      bookingIds: [bookingId],
      tenantId,
    });
  }

  static async sendPaymentLinkAfterBookingApproval(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    bookingIds = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    if (aggregated) {
      const paymentUrl = `${process.env.FRONTEND_URL}/payment/redirection?ids=${bookingIds.join(",")}&tenant=${tenantId}&aggregated=true`;
      await MailSenderService.dispatch({
        mailType: MailType.PAYMENT_LINK_AFTER_APPROVAL,
        address,
        bookingIds,
        tenantId,
        templateData: { paymentUrl },
        aggregated: true,
      });
    } else {
      for (const booking of bookings) {
        const paymentUrl = `${process.env.FRONTEND_URL}/payment/redirection?ids=${booking.id}&tenant=${tenantId}&aggregated=false`;
        await MailSenderService.dispatch({
          mailType: MailType.PAYMENT_LINK_AFTER_APPROVAL,
          address: booking.mail,
          bookingIds: [booking.id],
          tenantId,
          templateData: { paymentUrl },
        });
      }
    }
  }

  static async sendVerifyBookingRejection(
    address,
    bookingId,
    tenantId,
    hookId,
    reason,
    attachments,
    refundPreview = null,
  ) {
    const verifyRejectionUrl = `${process.env.FRONTEND_URL}/booking/verify-reject/${tenantId}?id=${bookingId}&hookId=${hookId}`;
    const refundTemplateData =
      CancellationRefundService.toMailTemplateData(refundPreview);

    await MailSenderService.dispatch({
      mailType: MailType.VERIFY_BOOKING_REJECTION,
      address,
      bookingIds: [bookingId],
      tenantId,
      templateData: {
        cancelReason: reason,
        verifyRejectionUrl,
        ...refundTemplateData,
      },
      attachments,
    });
  }

  static async sendAccessProvisioned(
    address,
    bookingId,
    tenantId,
    accessPoints,
  ) {
    await MailSenderService.dispatch({
      mailType: MailType.ACCESS_PROVISIONED,
      address,
      bookingIds: [bookingId],
      tenantId,
      templateData: { accessPoints },
    });
  }

  static async sendVerificationRequest(address, hookId, verifyUrl) {
    const instance = await InstanceManager.getInstance(false);

    let verifyUrlTemplate = "";

    if (!verifyUrl) {
      verifyUrlTemplate = `${process.env.BACKEND_URL}/auth/verify/${hookId}`;
    } else {
      verifyUrlTemplate = `${verifyUrl}?token=${hookId}&id=${encodeURIComponent(address)}`;
    }

    const content = renderSnippet("verification-request", {
      verifyUrl: verifyUrlTemplate,
    });

    await MailerService.send({
      address,
      subject: "Bestätigen Sie Ihre E-Mail-Adresse",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Bestätigen Sie Ihre E-Mail-Adresse",
        content,
      },
    });
  }

  static async sendPasswordResetRequest(address, hookId) {
    const instance = await InstanceManager.getInstance(false);
    const resetUrl = `${process.env.BACKEND_URL}/auth/reset/${hookId}`;

    const content = renderSnippet("password-reset", { resetUrl });

    await MailerService.send({
      address,
      subject: "Bestätigen Sie die Änderung Ihres Kennworts",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Bestätigen Sie die Änderung Ihres Kennworts",
        content,
      },
    });
  }

  static async sendForgotPasswordRequest(address, hookId, resetUrl) {
    const instance = await InstanceManager.getInstance(false);

    let resetUrlTemplate;

    if (resetUrl) {
      resetUrlTemplate = `${resetUrl}?token=${hookId}&id=${encodeURIComponent(address)}`;
    } else {
      resetUrlTemplate = `${process.env.FRONTEND_URL}/password/reset?token=${hookId}&id=${encodeURIComponent(address)}`;
    }

    const content = renderSnippet("forgot-password-request", {
      resetUrl: resetUrlTemplate,
    });

    await MailerService.send({
      address,
      subject: "Kennwort zurücksetzen",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Kennwort zurücksetzen",
        content,
      },
    });
  }

  static async sendUserCreated(userId) {
    const instance = await InstanceManager.getInstance(false);
    const user = await UserManager.getUser(userId);

    const content = renderSnippet("user-created", {
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
        content,
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

    const content = renderSnippet("workflow-notification", {
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
        content,
      },
      useInstanceMail: tenant.useInstanceMail,
    });
  }

  static async sendInvitationEmail({ sendTo, tenantId, token }) {
    const tenant = await TenantManager.getTenant(tenantId);
    const invitationUrl = `${process.env.FRONTEND_URL}/auth/invitation/${tenantId}?token=${token}`;

    const content = renderSnippet("invitation", {
      tenantName: tenant.name,
      invitationUrl,
      supportEmail: tenant.mail,
    });

    await MailerService.send({
      address: sendTo,
      subject: `Biletado - Einladung zum ${tenant.name} Mandanten`,
      mailTemplate: tenant.genericMailTemplate,
      model: {
        title: `Biletado - Einladung zum ${tenant.name} Mandanten`,
        content,
      },
      useInstanceMail: tenant.useInstanceMail,
    });
  }

  static async sendCardLinkRequest({
    address,
    firstName,
    hookId,
    cardLabel,
    linkUrlBase,
  }) {
    const instance = await InstanceManager.getInstance(false);

    const linkUrl = linkUrlBase
      ? `${linkUrlBase}?token=${hookId}&id=${encodeURIComponent(address)}`
      : `${process.env.BACKEND_URL}/auth/card/link?token=${hookId}&id=${encodeURIComponent(address)}`;

    const content = renderSnippet("card-link-request", {
      email: address,
      firstName,
      cardLabel,
      linkUrl,
    });

    await MailerService.send({
      address,
      subject: "Karte mit Ihrem Account verknüpfen",
      mailTemplate: instance.mailTemplate,
      model: {
        title: "Karte mit Ihrem Account verknüpfen",
        content,
      },
    });
  }
}

module.exports = MailController;
