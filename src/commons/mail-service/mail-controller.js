const MailerService = require("./mail-service");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const UserManager = require("../data-managers/user-manager");
const { renderSnippet } = require("./templates/template-loader");
const { compose, send } = require("./index");
const { groupBookingIdOf } = require("../services/documents/document-issuance");

/** Sends every mail of a composed notice. */
async function sendComposed(type, ctx) {
  for (const mail of await compose(type, ctx)) {
    await send(mail);
  }
}

/**
 * The context of a booking notice as the facade's callers name it: the
 * booking id or ids, and whether they mean the group. The facade does not
 * know the group's id; it looks it up the way the issuance does.
 */
async function contextOf(tenantId, bookingIds, aggregated, specific = {}) {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  return {
    tenantId,
    bookingIds: ids,
    groupBookingId: aggregated
      ? await groupBookingIdOf({
          tenantId,
          bookingIds: ids,
          groupBookingId: null,
        })
      : null,
    ...specific,
  };
}

/** The attachments the callers hand in (nodemailer form) as issued files. */
function issuedOf(attachments = []) {
  return attachments.map((att) => ({
    name: att.filename,
    buffer: att.content,
    contentType: att.contentType,
  }));
}

/**
 * The facade of the mail module for the callers the last ticket of the
 * mail-stack chain moves to `compose` + `send`: the payment providers, the
 * reprint, the access service, the workflow action and the account
 * services. The five booking notices they send go over `compose`; the
 * `address` the callers pass is ignored, the recipients are the type's
 * (spec 5.1). The seven tenant and instance notices still render here.
 * The nine notices of the booking lifecycle go through its mail adapter.
 */
class MailController {
  static async sendInvoice(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    await sendComposed(
      "INVOICE",
      await contextOf(tenantId, bookingIds, aggregated, {
        attachments: issuedOf(attachments),
      }),
    );
  }

  static async sendBookingConfirmedInvoicePending(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    await sendComposed(
      "BOOKING_CONFIRMED_INVOICE_PENDING",
      await contextOf(tenantId, bookingIds, aggregated),
    );
  }

  static async sendInvoiceAfterBookingApproval(
    address,
    bookingIds,
    tenantId,
    attachments,
    aggregated = false,
  ) {
    await sendComposed(
      "INVOICE_AFTER_APPROVAL",
      await contextOf(tenantId, bookingIds, aggregated, {
        attachments: issuedOf(attachments),
      }),
    );
  }

  static async sendPaymentLinkAfterBookingApproval(
    address,
    bookingIds,
    tenantId,
    aggregated = false,
  ) {
    const ctx = await contextOf(tenantId, bookingIds, aggregated);
    await sendComposed("PAYMENT_LINK_AFTER_APPROVAL", {
      ...ctx,
      paymentUrl: `${process.env.FRONTEND_URL}/payment/redirection?ids=${ctx.bookingIds.join(",")}&tenant=${tenantId}&aggregated=${aggregated ? "true" : "false"}`,
    });
  }

  static async sendAccessProvisioned(
    address,
    bookingId,
    tenantId,
    accessPoints,
  ) {
    await sendComposed(
      "ACCESS_PROVISIONED",
      await contextOf(tenantId, bookingId, false, { accessPoints }),
    );
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
      type: "verification-request",
      tenantId: null,
      to: address,
      subject: "Bestätigen Sie Ihre E-Mail-Adresse",
      html: await MailerService.renderHtml({
        mailTemplate: instance.mailTemplate,
        model: { title: "Bestätigen Sie Ihre E-Mail-Adresse", content },
      }),
    });
  }

  static async sendPasswordResetRequest(address, hookId) {
    const instance = await InstanceManager.getInstance(false);
    const resetUrl = `${process.env.BACKEND_URL}/auth/reset/${hookId}`;

    const content = renderSnippet("password-reset", { resetUrl });

    await MailerService.send({
      type: "password-reset",
      tenantId: null,
      to: address,
      subject: "Bestätigen Sie die Änderung Ihres Kennworts",
      html: await MailerService.renderHtml({
        mailTemplate: instance.mailTemplate,
        model: {
          title: "Bestätigen Sie die Änderung Ihres Kennworts",
          content,
        },
      }),
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
      type: "forgot-password-request",
      tenantId: null,
      to: address,
      subject: "Kennwort zurücksetzen",
      html: await MailerService.renderHtml({
        mailTemplate: instance.mailTemplate,
        model: { title: "Kennwort zurücksetzen", content },
      }),
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
      type: "user-created",
      tenantId: null,
      to: instance.mailAddress,
      subject: "Ein neuer Benutzer wurde erstellt",
      html: await MailerService.renderHtml({
        mailTemplate: instance.mailTemplate,
        model: { title: "Ein neuer Benutzer wurde erstellt", content },
      }),
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

    // Sent as the instance, as it always was: the tenant's shell template,
    // the instance's account. Ticket 4 of the mail-stack chain makes it a
    // tenant notice.
    await MailerService.send({
      type: "workflow-notification",
      tenantId: null,
      to: sendTo,
      subject: `Änderung bei der Buchung Nr. ${bookingId} - Neuer Status`,
      html: await MailerService.renderHtml({
        mailTemplate: tenant.genericMailTemplate,
        model: {
          title: `Änderung bei der Buchung Nr. ${bookingId} - Neuer Status`,
          content,
        },
      }),
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

    // Sent as the instance, as it always was: the tenant's shell template,
    // the instance's account. Ticket 4 of the mail-stack chain makes it a
    // tenant notice.
    await MailerService.send({
      type: "invitation",
      tenantId: null,
      to: sendTo,
      subject: `Biletado - Einladung zum ${tenant.name} Mandanten`,
      html: await MailerService.renderHtml({
        mailTemplate: tenant.genericMailTemplate,
        model: {
          title: `Biletado - Einladung zum ${tenant.name} Mandanten`,
          content,
        },
      }),
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
      type: "card-link-request",
      tenantId: null,
      to: address,
      subject: "Karte mit Ihrem Account verknüpfen",
      html: await MailerService.renderHtml({
        mailTemplate: instance.mailTemplate,
        model: { title: "Karte mit Ihrem Account verknüpfen", content },
      }),
    });
  }
}

module.exports = MailController;
