/**
 * `compose(type, ctx)` of the mail module (mail-stack spec, section 2):
 * one notice (glossary "Mitteilung") composed as mail values over the
 * fixture store of `helpers/mail-stack-fixtures.js` - who gets it
 * (glossary "Empfängerkreis"), what is attached and in which order, the
 * aggregated notice of a group (glossary "Sammelmitteilung"), and that
 * the loader reads each entity once. What the body looks like is pinned
 * by the snapshots of `mail-characterization.test.js`.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const Handlebars = require("handlebars");

const { compose } = require("../src/commons/mail-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const { BadRequestError } = require("../src/errors/BaseError");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const {
  TENANT,
  TENANT_MAIL,
  INSTANCE_MAIL,
  CUSTOMER,
  SUPERVISOR,
  SECRETARY,
  ORGANIZER,
  GROUP,
  GROUP_MEMBER_IDS,
  FRONTEND_URL,
  BACKEND_URL,
  NOW,
  tenant,
  booking,
  concert,
  membership,
  installMailStackStore,
  issuedFile,
} = require("./helpers/mail-stack-fixtures");

describe("compose: a notice as mail values", function () {
  let env;

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

  const filenames = (mail) => mail.attachments.map((att) => att.filename);
  const single = (id = "B-1") => ({ tenantId: TENANT, bookingIds: [id] });
  const group = () => ({
    tenantId: TENANT,
    bookingIds: GROUP_MEMBER_IDS,
    groupBookingId: GROUP,
  });

  describe("the booker's notices", function () {
    it("a booking confirmation: to the booker, a copy to the tenant, the receipt first, then the mailAttach document, the iCal and the QR code", async function () {
      installMailStackStore();

      const mails = await compose("BOOKING_CONFIRMATION", {
        ...single(),
        attachments: [issuedFile("RE-1.pdf")],
      });

      expect(mails).to.have.length(1);
      const [mail] = mails;
      expect(mail).to.include({
        type: "BOOKING_CONFIRMATION",
        tenantId: TENANT,
        to: CUSTOMER,
        bcc: TENANT_MAIL,
        subject: "Stadthalle Musterstadt: Ihre Buchung, Erika Musterfrau",
      });
      expect(filenames(mail)).to.deep.equal([
        "RE-1.pdf",
        "Hausordnung.pdf",
        "buchung-B-1.ics",
        "qrcode.png",
      ]);
      expect(mail.html).to.include("Buchungsnummer:</strong> B-1");
    });

    it("a request confirmation: the mailAttach document, no iCal, no copy", async function () {
      installMailStackStore();

      const [mail] = await compose("BOOKING_REQUEST_CONFIRMATION", single());

      expect(mail.bcc).to.equal(undefined);
      expect(filenames(mail)).to.deep.equal(["Hausordnung.pdf", "qrcode.png"]);
    });

    it("a cancellation: the cancellation document only, no mailAttach document, always a copy to the tenant", async function () {
      installMailStackStore({ tenant: tenant({ receiptEnableBCC: false }) });

      const [mail] = await compose("BOOKING_CANCEL", {
        ...single("B-cancelled"),
        attachments: [issuedFile("ST-1.pdf")],
        reason: "Der Saal wird renoviert.",
      });

      expect(mail.bcc).to.equal(TENANT_MAIL);
      expect(filenames(mail)).to.deep.equal(["ST-1.pdf"]);
      expect(mail.html).to.include("Der Saal wird renoviert.");
      expect(mail.html).to.include("90,38");
    });

    it("the copy of a confirmation stays away where the tenant does not want receipts copied", async function () {
      installMailStackStore({ tenant: tenant({ receiptEnableBCC: false }) });

      const [mail] = await compose("BOOKING_CONFIRMATION", {
        ...single(),
        attachments: [issuedFile("RE-1.pdf")],
      });

      expect(mail.bcc).to.equal(undefined);
    });

    it("the payment link goes to the booker, whoever asked", async function () {
      installMailStackStore();

      const [mail] = await compose("PAYMENT_LINK_AFTER_APPROVAL", {
        ...single(),
        paymentUrl: "https://pay.example.test/x",
      });

      expect(mail.to).to.equal(CUSTOMER);
      expect(mail.html).to.include("https://pay.example.test/x");
    });

    it("a mailAttach document that cannot be loaded is left out, the mail still goes", async function () {
      installMailStackStore({
        bookings: [
          booking({
            attachments: [
              {
                id: "att-gone",
                title: "Verschollen",
                type: "file",
                reference: { source: "media", mediaId: "M-gone" },
                mailAttach: true,
              },
            ],
          }),
        ],
      });

      const [mail] = await compose("BOOKING_REQUEST_CONFIRMATION", single());

      expect(filenames(mail)).to.deep.equal(["qrcode.png"]);
    });
  });

  describe("the aggregated notice of a group", function () {
    it("is one mail to the first member's address with every member in short form, one receipt and the mailAttach documents of every member", async function () {
      installMailStackStore();

      const mails = await compose("BOOKING_CONFIRMATION", {
        ...group(),
        attachments: [issuedFile("RE-2.pdf")],
      });

      expect(mails).to.have.length(1);
      const [mail] = mails;
      expect(mail.to).to.equal(CUSTOMER);
      expect(filenames(mail)).to.deep.equal([
        "RE-2.pdf",
        "Hausordnung.pdf",
        "buchungen.ics",
      ]);
      for (const id of GROUP_MEMBER_IDS) {
        expect(mail.html).to.include(id);
      }
    });

    it("more than one booking without a group is a programming error, not a fan-out", async function () {
      installMailStackStore();

      let error;
      try {
        await compose("BOOKING_CONFIRMATION", {
          tenantId: TENANT,
          bookingIds: ["G-1", "G-2"],
        });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(BadRequestError);
    });
  });

  describe("the tenant's notice", function () {
    it("goes to the tenant's address", async function () {
      installMailStackStore();

      const mails = await compose("INCOMING_BOOKING", single());

      expect(mails.map((mail) => mail.to)).to.deep.equal([TENANT_MAIL]);
    });

    it("is nothing where the tenant does not want one", async function () {
      installMailStackStore({ tenant: tenant({ notifyOnNewBooking: false }) });

      expect(await compose("INCOMING_BOOKING", single())).to.deep.equal([]);
    });
  });

  describe("the supervisors' notice", function () {
    it("is one mail per recipient of the booker's membership - by address, by account, by role - never to the booker", async function () {
      installMailStackStore();

      const mails = await compose("SUPERVISOR_BOOKING_NOTIFICATION", single());

      expect(mails.map((mail) => mail.to)).to.have.members([
        SUPERVISOR,
        SECRETARY,
      ]);
      expect(mails.map((mail) => mail.bcc)).to.deep.equal([
        undefined,
        undefined,
      ]);
    });

    it("of a group is one aggregated mail per recipient", async function () {
      installMailStackStore();

      const mails = await compose("SUPERVISOR_BOOKING_NOTIFICATION", group());

      expect(mails).to.have.length(2);
      expect(mails[0].html).to.include("G-3");
    });

    it("leaves out the booker's address even where it differs from the account", async function () {
      installMailStackStore({
        bookings: [booking({ mail: "andere@example.test" })],
        membership: membership({
          bookingNotificationRecipients: [
            { type: "email", value: "andere@example.test", label: "" },
            { type: "email", value: SUPERVISOR, label: "" },
          ],
        }),
      });

      const mails = await compose("SUPERVISOR_BOOKING_NOTIFICATION", single());

      expect(mails.map((mail) => mail.to)).to.deep.equal([SUPERVISOR]);
    });

    it("is nothing for a guest booking, where the tenant has it off, or where the membership names nobody", async function () {
      installMailStackStore({ bookings: [booking({ assignedUserId: "" })] });
      expect(
        await compose("SUPERVISOR_BOOKING_NOTIFICATION", single()),
      ).to.deep.equal([]);
      sinon.restore();

      installMailStackStore({
        tenant: tenant({ notifySupervisorsOnBooking: false }),
      });
      expect(
        await compose("SUPERVISOR_BOOKING_NOTIFICATION", single()),
      ).to.deep.equal([]);
      sinon.restore();

      installMailStackStore({ membership: null });
      expect(
        await compose("SUPERVISOR_BOOKING_NOTIFICATION", single()),
      ).to.deep.equal([]);
    });
  });

  describe("the organizers' notice", function () {
    it("goes to the organizer of the event of every ticket position, once per organizer", async function () {
      installMailStackStore({
        bookings: [
          booking({
            id: "T-1",
            bookableItems: [
              { bookableId: "ticket", amount: 1 },
              { bookableId: "ticket", amount: 2 },
            ],
          }),
        ],
      });

      const mails = await compose("NEW_BOOKING", single("T-1"));

      expect(mails.map((mail) => mail.to)).to.deep.equal([ORGANIZER]);
      expect(mails[0].html).to.include("Herbstkonzert");
    });

    it("is nothing for a booking without a ticket position, or where the event names no address", async function () {
      installMailStackStore();
      expect(await compose("NEW_BOOKING", single())).to.deep.equal([]);
      sinon.restore();

      installMailStackStore({ events: [concert({ eventOrganizer: {} })] });
      expect(await compose("NEW_BOOKING", single("G-3"))).to.deep.equal([]);
    });
  });

  describe("the account and tenant notices", function () {
    const encoded = encodeURIComponent(CUSTOMER);
    /** A link as the snippet prints it: Handlebars-escaped. */
    const link = (url) => Handlebars.Utils.escapeExpression(url);

    it("a verification request: an instance mail to the address named, the storefront's verify URL carrying token and address", async function () {
      installMailStackStore();

      const mails = await compose("VERIFICATION_REQUEST", {
        to: CUSTOMER,
        hookId: "hook-verify-1",
        verifyUrl: `${FRONTEND_URL}/auth/verify`,
      });

      expect(mails).to.have.length(1);
      expect(mails[0]).to.include({
        type: "VERIFICATION_REQUEST",
        tenantId: null,
        to: CUSTOMER,
        subject: "Bestätigen Sie Ihre E-Mail-Adresse",
      });
      expect(mails[0].attachments).to.deep.equal([]);
      expect(mails[0].html).to.include(
        link(`${FRONTEND_URL}/auth/verify?token=hook-verify-1&id=${encoded}`),
      );
    });

    it("a verification request without a verify URL links the backend's own route", async function () {
      installMailStackStore();

      const [mail] = await compose("VERIFICATION_REQUEST", {
        to: CUSTOMER,
        hookId: "hook-verify-1",
      });

      expect(mail.html).to.include(
        link(`${BACKEND_URL}/auth/verify/hook-verify-1`),
      );
    });

    it("a forgot-password request and a card link request build their links the same way, with the storefront's route or the backend's", async function () {
      installMailStackStore();

      const [forgot] = await compose("FORGOT_PASSWORD_REQUEST", {
        to: CUSTOMER,
        hookId: "hook-forgot-1",
      });
      const [card] = await compose("CARD_LINK_REQUEST", {
        to: CUSTOMER,
        firstName: "Erika",
        hookId: "hook-card-1",
        cardLabel: "Bibliothekskarte",
        linkUrlBase: `${FRONTEND_URL}/auth/card/link`,
      });

      expect(forgot.html).to.include(
        link(
          `${FRONTEND_URL}/password/reset?token=hook-forgot-1&id=${encoded}`,
        ),
      );
      expect(card.html).to.include(
        link(`${FRONTEND_URL}/auth/card/link?token=hook-card-1&id=${encoded}`),
      );
      expect(card.html).to.include("Bibliothekskarte");
    });

    it("the notice of a new user goes to the instance's address, the user read by id", async function () {
      installMailStackStore();

      const mails = await compose("USER_CREATED", { userId: CUSTOMER });

      expect(mails).to.have.length(1);
      expect(mails[0]).to.include({
        tenantId: null,
        to: INSTANCE_MAIL,
        subject: "Ein neuer Benutzer wurde erstellt",
      });
      expect(mails[0].html).to.include("Musterfrau");
      expect(mails[0].html).to.include(CUSTOMER);
    });

    it("an invitation is a tenant mail to the address named, over the tenant's template, with the storefront's invitation link", async function () {
      installMailStackStore();

      const [mail] = await compose("INVITATION", {
        tenantId: TENANT,
        to: "neu@example.test",
        token: "invite-token-1",
      });

      expect(mail).to.include({
        type: "INVITATION",
        tenantId: TENANT,
        to: "neu@example.test",
        subject: "Biletado - Einladung zum Stadthalle Musterstadt Mandanten",
      });
      expect(mail.html).to.include(
        link(`${FRONTEND_URL}/auth/invitation/${TENANT}?token=invite-token-1`),
      );
    });

    it("a workflow notification names the booking in its subject and reads the tenant only, never the booking", async function () {
      installMailStackStore();

      const [mail] = await compose("WORKFLOW_NOTIFICATION", {
        tenantId: TENANT,
        bookingIds: ["B-1"],
        to: SUPERVISOR,
        oldStatus: "Eingegangen",
        newStatus: "Geprüft",
      });

      expect(mail).to.include({
        tenantId: TENANT,
        to: SUPERVISOR,
        subject: "Änderung bei der Buchung Nr. B-1 - Neuer Status",
      });
      expect(mail.html).to.include("Geprüft");
      expect(TenantManager.getTenant.callCount).to.equal(1);
      expect(BookingManager.getBookings.callCount).to.equal(0);
      expect(BookingManager.getBooking.callCount).to.equal(0);
    });

    it("an instance notice reads the instance once and no tenant", async function () {
      installMailStackStore();

      await compose("PASSWORD_RESET", { to: CUSTOMER, hookId: "hook-reset-1" });

      expect(InstanceManager.getInstance.callCount).to.equal(1);
      expect(TenantManager.getTenant.callCount).to.equal(0);
    });

    it("a notice to a named address without one is nothing", async function () {
      installMailStackStore();

      expect(
        await compose("PASSWORD_RESET", { hookId: "hook-reset-1" }),
      ).to.deep.equal([]);
    });
  });

  describe("the loader", function () {
    it("reads the tenant, the bookings and their bookables once each, by id, never the tenant's whole catalogue - the calendar file included", async function () {
      installMailStackStore();

      await compose("BOOKING_CONFIRMATION", group());

      expect(TenantManager.getTenant.callCount).to.equal(1);
      expect(BookingManager.getBookings.callCount).to.equal(1);
      expect(BookingManager.getBooking.callCount).to.equal(0);
      expect(BookableManager.getBookablesByIds.callCount).to.equal(1);
      expect(BookableManager.getBookablesByIds.firstCall.args).to.deep.equal([
        TENANT,
        ["room", "ticket"],
      ]);
      expect(BookableManager.getBookable.callCount).to.equal(0);
      expect(BookableManager.getBookables.callCount).to.equal(0);
      expect(EventManager.getEvent.callCount).to.equal(1);
    });

    it("refuses a type the registry does not know", async function () {
      installMailStackStore();

      let error;
      try {
        await compose("NO_SUCH_NOTICE", single());
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(error.message).to.match(/NO_SUCH_NOTICE/);
    });
  });
});
