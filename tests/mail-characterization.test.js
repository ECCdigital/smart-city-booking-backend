/**
 * Characterization of every notice (glossary "Mitteilung") the platform
 * sends: the 14 booking notices over `compose` + `send`, the two tenant
 * notices and the five instance notices that `MailController` still
 * renders and sends directly - each run over the fixture of
 * `helpers/mail-stack-fixtures.js` and the in-memory transport, and
 * pinned as a snapshot of recipient, subject, attachment names and the
 * rendered HTML under `tests/snapshots/mail/`.
 *
 * The nine notices the booking lifecycle sends go in through its mail
 * adapter (`booking-lifecycle/adapters/mail.js`, `send(type, ctx)`), the
 * way the lifecycle calls them; the five booking notices of the other
 * callers go in at the `MailController` facade, the way the payment
 * providers, the reprint and the access service still call it until the
 * last ticket of the chain.
 *
 * Written for the first ticket of the mail-stack chain (Wayfinder,
 * "Mail-Stack (1): Charakterisierung ..."; spec section 6) against the
 * stack as it was, and kept byte-identical through ticket 3 (compose): the
 * snapshots are the regression net of the split. A change the chain makes
 * on purpose is accepted with `UPDATE_SNAPSHOTS=1 npm test` and named in
 * the changelog.
 *
 * Dates render in Europe/Berlin where the formatters say so; the event
 * date of a ticket goes through a formatter without a zone and renders the
 * same in UTC and CET, which is where these run.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const MailController = require("../src/commons/mail-service/mail-controller");
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const {
  mailAttachments: fileAttachment,
} = require("../src/commons/services/documents/document-issuance");
const { expectSnapshot } = require("./helpers/snapshot");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  TENANT,
  GROUP,
  GROUP_MEMBER_IDS,
  CUSTOMER,
  SUPERVISOR,
  FRONTEND_URL,
  BACKEND_URL,
  NOW,
  tenant,
  cancellationRefund,
  installMailStackStore,
  issuedFile,
} = require("./helpers/mail-stack-fixtures");

/** The one mail sent, as a snapshot: headers, then the body. */
function snapshotOf(sent) {
  const attachments = (sent.attachments || [])
    .map((attachment) => attachment.filename)
    .join(", ");
  return [
    `From: ${sent.from}`,
    `To: ${sent.to}`,
    `Bcc: ${sent.bcc ?? ""}`,
    `Subject: ${sent.subject}`,
    `Attachments: ${attachments}`,
    "",
    sent.html,
  ].join("\n");
}

describe("mail characterization: every notice as it goes out today", function () {
  let sent;
  let store;
  let env;

  /** The fixture behind the store, the in-memory transport in front. */
  function given(options = {}) {
    store = installMailStackStore(options);
    sent = installInMemoryMailTransport();
  }

  /** The context of a notice of one booking, as the lifecycle names it. */
  const single = (id, specific = {}) => ({
    tenantId: TENANT,
    bookingIds: [id],
    ...specific,
  });
  /** The context of the aggregated notice of the group of three. */
  const group = (specific = {}) => ({
    tenantId: TENANT,
    bookingIds: GROUP_MEMBER_IDS,
    groupBookingId: GROUP,
    ...specific,
  });

  beforeEach(function () {
    env = {
      FRONTEND_URL: process.env.FRONTEND_URL,
      BACKEND_URL: process.env.BACKEND_URL,
    };
    process.env.FRONTEND_URL = FRONTEND_URL;
    process.env.BACKEND_URL = BACKEND_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env.FRONTEND_URL;
    process.env.BACKEND_URL = env.BACKEND_URL;
  });

  /** Runs a send and pins the first of the mails it produced. */
  async function pin(name, send, { count = 1 } = {}) {
    if (!store) given();
    await send();
    expect(sent, `${name}: ${count} mail(s)`).to.have.length(count);
    expectSnapshot(`mail/${name}.txt`, snapshotOf(sent[0]));
  }

  afterEach(function () {
    store = null;
  });

  describe("booking notices of the lifecycle, single booking", function () {
    it("booking confirmation: receipt, then the mailAttach document, iCal, QR code, BCC to the tenant", async function () {
      await pin("booking-confirmation", () =>
        mail.send(
          "BOOKING_CONFIRMATION",
          single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
        ),
      );
    });

    it("booking confirmation without the public status view: no QR code", async function () {
      given({ tenant: tenant({ enablePublicStatusView: false }) });
      await pin("booking-confirmation.no-status-view", () =>
        mail.send(
          "BOOKING_CONFIRMATION",
          single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
        ),
      );
    });

    it("booking confirmation of a tenant without overrides: the file snippet, no after-text, no footer, no BCC", async function () {
      given({
        tenant: tenant({
          mailSnippets: {},
          mailSubjects: {},
          mailShowSupportFooter: false,
          receiptEnableBCC: false,
        }),
      });
      await pin("booking-confirmation.plain-tenant", () =>
        mail.send(
          "BOOKING_CONFIRMATION",
          single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
        ),
      );
    });

    it("free booking confirmation: mailAttach document and iCal, no receipt, no BCC", async function () {
      await pin("free-booking-confirmation", () =>
        mail.send("FREE_BOOKING_CONFIRMATION", single("B-1")),
      );
    });

    it("request confirmation: mailAttach document, no iCal", async function () {
      await pin("booking-request-confirmation", () =>
        mail.send("BOOKING_REQUEST_CONFIRMATION", single("B-1")),
      );
    });

    it("cancellation: the cancellation document, the reason, the refund of the booking, BCC to the tenant", async function () {
      await pin("booking-cancel", () =>
        mail.send(
          "BOOKING_CANCEL",
          single("B-cancelled", {
            attachments: [issuedFile("ST-1.pdf")],
            reason: "Der Saal wird renoviert.",
          }),
        ),
      );
    });

    it("rejection: the reason, no document", async function () {
      await pin("booking-rejection", () =>
        mail.send(
          "BOOKING_REJECTION",
          single("B-1", { reason: "Keine Kapazität am gewünschten Tag." }),
        ),
      );
    });

    it("verification of a cancellation request: the link with the hook, the reason, the refund preview", async function () {
      await pin("verify-rejection", () =>
        mail.send(
          "VERIFY_BOOKING_REJECTION",
          single("B-1", {
            hookId: "hook-reject-1",
            reason: "Termin verschoben",
            refundPreview: cancellationRefund(),
          }),
        ),
      );
    });

    it("the tenant's notice of a new booking", async function () {
      await pin("incoming-booking", () =>
        mail.send("INCOMING_BOOKING", single("B-1")),
      );
    });

    it("the organizer's notice of a new ticket booking: the event in the booking details", async function () {
      await pin("new-booking", () => mail.send("NEW_BOOKING", single("G-3")));
    });

    it("the supervisors' notice of a new booking: one mail per supervisor, the first pinned", async function () {
      await pin(
        "supervisor-booking-notification",
        () => mail.send("SUPERVISOR_BOOKING_NOTIFICATION", single("B-1")),
        { count: 2 },
      );
    });
  });

  describe("booking notices of the lifecycle, group of three", function () {
    it("group booking confirmation: one mail, the members in short form, one receipt, the mailAttach documents of every member", async function () {
      await pin("booking-confirmation.group", () =>
        mail.send(
          "BOOKING_CONFIRMATION",
          group({ attachments: [issuedFile("RE-2.pdf")] }),
        ),
      );
    });

    it("group request confirmation", async function () {
      await pin("booking-request-confirmation.group", () =>
        mail.send("BOOKING_REQUEST_CONFIRMATION", group()),
      );
    });

    it("group cancellation: the refund is read off the first member", async function () {
      await pin("booking-cancel.group", () =>
        mail.send(
          "BOOKING_CANCEL",
          group({
            attachments: [issuedFile("ST-2.pdf")],
            reason: "Die Veranstaltung fällt aus.",
          }),
        ),
      );
    });

    it("the tenant's notice of a new group booking", async function () {
      await pin("incoming-booking.group", () =>
        mail.send("INCOMING_BOOKING", group()),
      );
    });
  });

  describe("booking notices of the other callers, at the facade", function () {
    it("invoice (reprint and invoice payment): the invoice, no iCal", async function () {
      await pin("invoice", () =>
        MailController.sendInvoice(
          CUSTOMER,
          "B-1",
          TENANT,
          fileAttachment(issuedFile("RG-1.pdf")),
        ),
      );
    });

    it("group invoice", async function () {
      await pin("invoice.group", () =>
        MailController.sendInvoice(
          CUSTOMER,
          ["G-1", "G-2", "G-3"],
          TENANT,
          fileAttachment(issuedFile("RG-2.pdf")),
          true,
        ),
      );
    });

    it("booking confirmed, invoice to follow: iCal, no document", async function () {
      await pin("booking-confirmed-invoice-pending", () =>
        MailController.sendBookingConfirmedInvoicePending(
          CUSTOMER,
          "B-1",
          TENANT,
        ),
      );
    });

    it("invoice after approval: the invoice, no cancellation link", async function () {
      await pin("invoice-after-approval", () =>
        MailController.sendInvoiceAfterBookingApproval(
          CUSTOMER,
          "B-1",
          TENANT,
          fileAttachment(issuedFile("RG-1.pdf")),
        ),
      );
    });

    it("payment link after approval: the link of the one booking", async function () {
      await pin("payment-link-after-approval", () =>
        MailController.sendPaymentLinkAfterBookingApproval(
          CUSTOMER,
          "B-1",
          TENANT,
        ),
      );
    });

    it("payment link after approval of a group: one link for all members", async function () {
      await pin("payment-link-after-approval.group", () =>
        MailController.sendPaymentLinkAfterBookingApproval(
          CUSTOMER,
          ["G-1", "G-2", "G-3"],
          TENANT,
          true,
        ),
      );
    });

    it("access provisioned: the access points with their PINs", async function () {
      await pin("access-provisioned", () =>
        MailController.sendAccessProvisioned(CUSTOMER, "B-1", TENANT, [
          {
            label: "Haupteingang",
            bookableTitle: "Großer Saal",
            provider: "nuki",
            pin: "482913",
          },
          { label: "Seiteneingang", provider: "salto-ks", pin: "775310" },
        ]),
      );
    });
  });

  describe("tenant notices without the booking mail stack", function () {
    it("workflow notification: the status change, over the tenant's template", async function () {
      await pin("workflow-notification", () =>
        MailController.sendWorkflowNotification({
          sendTo: SUPERVISOR,
          tenantId: TENANT,
          bookingId: "B-1",
          oldStatus: "Eingegangen",
          newStatus: "Geprüft",
        }),
      );
    });

    it("invitation: the link with the token, over the tenant's template", async function () {
      await pin("invitation", () =>
        MailController.sendInvitationEmail({
          sendTo: "neu@example.test",
          tenantId: TENANT,
          token: "invite-token-1",
        }),
      );
    });
  });

  describe("instance notices", function () {
    it("verification request with the storefront's verify URL", async function () {
      await pin("verification-request", () =>
        MailController.sendVerificationRequest(
          CUSTOMER,
          "hook-verify-1",
          `${FRONTEND_URL}/auth/verify`,
        ),
      );
    });

    it("verification request without a verify URL: the backend's own route", async function () {
      await pin("verification-request.backend-url", () =>
        MailController.sendVerificationRequest(CUSTOMER, "hook-verify-1"),
      );
    });

    it("password reset: the backend's confirmation route", async function () {
      await pin("password-reset", () =>
        MailController.sendPasswordResetRequest(CUSTOMER, "hook-reset-1"),
      );
    });

    it("forgot password with the storefront's reset URL", async function () {
      await pin("forgot-password-request", () =>
        MailController.sendForgotPasswordRequest(
          CUSTOMER,
          "hook-forgot-1",
          `${FRONTEND_URL}/auth/reset`,
        ),
      );
    });

    it("forgot password without a reset URL: the storefront's default route", async function () {
      await pin("forgot-password-request.default-url", () =>
        MailController.sendForgotPasswordRequest(CUSTOMER, "hook-forgot-1"),
      );
    });

    it("user created: to the instance's address", async function () {
      await pin("user-created", () => MailController.sendUserCreated(CUSTOMER));
    });

    it("card link request with the storefront's link URL", async function () {
      await pin("card-link-request", () =>
        MailController.sendCardLinkRequest({
          address: CUSTOMER,
          firstName: "Erika",
          hookId: "hook-card-1",
          cardLabel: "Bibliothekskarte",
          linkUrlBase: `${FRONTEND_URL}/auth/card/link`,
        }),
      );
    });

    it("card link request without a link URL: the backend's own route", async function () {
      await pin("card-link-request.backend-url", () =>
        MailController.sendCardLinkRequest({
          address: CUSTOMER,
          firstName: "",
          hookId: "hook-card-1",
          cardLabel: "",
        }),
      );
    });
  });
});
