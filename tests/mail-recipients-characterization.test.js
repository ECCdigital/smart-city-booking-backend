/**
 * Characterization of who gets a notice today (glossary "Empfängerkreis"),
 * seen at the transport: the recipient rules are spread over the mail
 * adapter of the booking lifecycle, `MailController`,
 * `SupervisorNotificationService` and `MailerService`, and this pins each
 * of them where it is - the payment link that ignores the address it is
 * given, the BCC to the tenant, the tenant's gate on its own notice, the
 * supervisors without the booker, the organizers read off the bookables
 * used, the fan-out of a list of bookings, and the two silent exits of the
 * transport.
 *
 * Written for the first ticket of the mail-stack chain (Wayfinder,
 * "Mail-Stack (1): Charakterisierung ..."; spec sections 1 and 5). It
 * pins, it does not judge: where the spec changes a rule on purpose, the
 * case says so and names the ticket that turns it.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const MailController = require("../src/commons/mail-service/mail-controller");
const MailerService = require("../src/commons/mail-service/mail-service");
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const {
  SKIPPED,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  TENANT,
  TENANT_MAIL,
  CUSTOMER,
  BOOKER_USER,
  SUPERVISOR,
  SECRETARY,
  ORGANIZER,
  FRONTEND_URL,
  NOW,
  tenant,
  instance,
  booking,
  ticket,
  concert,
  membership,
  installMailStackStore,
  issuedFile,
} = require("./helpers/mail-stack-fixtures");

describe("mail recipients today: who gets which notice", function () {
  let sent;
  let store;
  let env;

  function given(options = {}) {
    store = installMailStackStore(options);
    sent = installInMemoryMailTransport();
  }

  const stored = (id) => store.bookings.find((entry) => entry.id === id);
  const recipients = () => sent.map((entry) => entry.to);

  beforeEach(function () {
    env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env;
    store = null;
  });

  describe("the payment link after approval", function () {
    it("goes to the booking's own address, whatever address it is given (spec 5.1: no address at the seam after ticket 3)", async function () {
      given();

      await MailController.sendPaymentLinkAfterBookingApproval(
        "jemand-anderes@example.test",
        "B-1",
        TENANT,
      );

      expect(recipients()).to.deep.equal([CUSTOMER]);
    });

    it("of a group goes to the address it is given", async function () {
      given();

      await MailController.sendPaymentLinkAfterBookingApproval(
        "jemand-anderes@example.test",
        ["G-1", "G-2", "G-3"],
        TENANT,
        true,
      );

      expect(recipients()).to.deep.equal(["jemand-anderes@example.test"]);
    });
  });

  describe("the copy to the tenant (BCC)", function () {
    it("goes with a booking confirmation that carries a document, where the tenant wants receipts copied", async function () {
      given();

      await mail.sendBookingConfirmation([stored("B-1")], {
        attachments: [issuedFile("RE-1.pdf")],
      });

      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("goes with a booking confirmation without a document too, because the iCal of a timed booking counts as one", async function () {
      given({ bookings: [booking({ attachments: [] })] });

      await mail.sendBookingConfirmation([stored("B-1")], { attachments: [] });

      expect(sent[0].attachments.map((a) => a.filename)).to.deep.equal([
        "buchung-B-1.ics",
        "qrcode.png",
      ]);
      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("goes with the confirmation of a booking without a time too: an iCal without an event is still attached", async function () {
      given({
        bookings: [
          booking({ attachments: [], timeBegin: null, timeEnd: null }),
        ],
        tenant: tenant({ enablePublicStatusView: false }),
      });

      await mail.sendBookingConfirmation([stored("B-1")], { attachments: [] });

      expect(sent[0].attachments.map((a) => a.filename)).to.deep.equal([
        "buchung-B-1.ics",
      ]);
      expect(sent[0].attachments[0].content.toString()).to.not.include(
        "BEGIN:VEVENT",
      );
      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("stays away where the tenant does not want receipts copied", async function () {
      given({ tenant: tenant({ receiptEnableBCC: false }) });

      await mail.sendBookingConfirmation([stored("B-1")], {
        attachments: [issuedFile("RE-1.pdf")],
      });

      expect(sent[0].bcc).to.equal(undefined);
    });

    it("always goes with a cancellation", async function () {
      given({ tenant: tenant({ receiptEnableBCC: false }) });

      await mail.sendBookingCancel([stored("B-cancelled")], {
        attachments: [],
        reason: "",
      });

      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("never goes with a free booking confirmation, documents or not", async function () {
      given();

      await mail.sendFreeBookingConfirmation([stored("B-1")], {
        attachments: [issuedFile("RE-1.pdf")],
      });

      expect(sent[0].bcc).to.equal(undefined);
    });
  });

  describe("the tenant's notice of a new booking", function () {
    it("goes to the tenant's address", async function () {
      given();

      const answer = await mail.sendTenantMail([stored("B-1")]);

      expect(answer).to.equal(undefined);
      expect(recipients()).to.deep.equal([TENANT_MAIL]);
    });

    it("is skipped, nothing sent, where the tenant does not want one", async function () {
      given({ tenant: tenant({ notifyOnNewBooking: false }) });

      const answer = await mail.sendTenantMail([stored("B-1")]);

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });
  });

  describe("the supervisors' notice of a new booking", function () {
    it("goes to every recipient of the booker's membership - by address, by account, by role - once each, and never to the booker", async function () {
      given();

      await mail.sendSupervisorMail([stored("B-1")]);

      expect(recipients()).to.have.members([SUPERVISOR, SECRETARY]);
      expect(recipients()).to.not.include(BOOKER_USER);
      expect(sent.map((entry) => entry.bcc)).to.deep.equal([
        undefined,
        undefined,
      ]);
    });

    it("of a group is one mail per recipient", async function () {
      given();

      await mail.sendSupervisorMail(["G-1", "G-2", "G-3"].map(stored), {
        aggregated: true,
      });

      expect(recipients()).to.have.members([SUPERVISOR, SECRETARY]);
      expect(sent[0].html).to.include("G-1");
      expect(sent[0].html).to.include("G-3");
    });

    it("leaves out the booker's address even where it differs from the booker's account", async function () {
      given({
        bookings: [booking({ mail: "andere@example.test" })],
        membership: membership({
          bookingNotificationRecipients: [
            { type: "email", value: "andere@example.test", label: "" },
            { type: "email", value: SUPERVISOR, label: "" },
          ],
        }),
      });

      await mail.sendSupervisorMail([stored("B-1")]);

      expect(recipients()).to.deep.equal([SUPERVISOR]);
    });

    it("is not sent for a guest booking without an account", async function () {
      given({ bookings: [booking({ assignedUserId: "" })] });

      await mail.sendSupervisorMail([stored("B-1")]);

      expect(sent).to.have.length(0);
    });

    it("is not sent where the tenant has supervisor notices off", async function () {
      given({ tenant: tenant({ notifySupervisorsOnBooking: false }) });

      await mail.sendSupervisorMail([stored("B-1")]);

      expect(sent).to.have.length(0);
    });

    it("is not sent where the booker's membership names nobody", async function () {
      given({ membership: null });

      await mail.sendSupervisorMail([stored("B-1")]);

      expect(sent).to.have.length(0);
    });
  });

  describe("the organizers' notice of a new ticket booking", function () {
    /** The ticket booking as the lifecycle carries it: bookables used. */
    function ticketBooking(items) {
      return booking({
        id: "T-1",
        bookableItems: items,
      });
    }

    it("goes to the organizer of the event of every ticket position, read off the bookable used, once per organizer", async function () {
      const entity = ticketBooking([
        { bookableId: "ticket", amount: 1, _bookableUsed: ticket() },
        { bookableId: "ticket", amount: 2, _bookableUsed: ticket() },
      ]);
      given({ bookings: [entity] });

      await mail.sendEmailToOrganizer([entity]);

      expect(recipients()).to.deep.equal([ORGANIZER]);
    });

    it("is not sent for a booking without a ticket position", async function () {
      const entity = ticketBooking([
        { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
      ]);
      given({ bookings: [entity] });

      await mail.sendEmailToOrganizer([entity]);

      expect(sent).to.have.length(0);
    });

    it("is not sent where the event names no organizer address", async function () {
      const entity = ticketBooking([
        { bookableId: "ticket", amount: 1, _bookableUsed: ticket() },
      ]);
      given({
        bookings: [entity],
        events: [concert({ eventOrganizer: {} })],
      });

      await mail.sendEmailToOrganizer([entity]);

      expect(sent).to.have.length(0);
    });
  });

  describe("a list of bookings without a group", function () {
    it("fans out: one mail per booking, each with the same documents, to the one address (spec 5.7: a programming error after ticket 3)", async function () {
      given();

      await MailController.sendBookingConfirmation(
        CUSTOMER,
        ["G-1", "G-2"],
        TENANT,
        [{ filename: "RE-1.pdf", content: Buffer.from("%PDF") }],
      );

      expect(recipients()).to.deep.equal([CUSTOMER, CUSTOMER]);
      expect(sent[0].html).to.include("G-1");
      expect(sent[1].html).to.include("G-2");
      for (const entry of sent) {
        expect(entry.attachments[0].filename).to.equal("RE-1.pdf");
      }
    });
  });

  describe("the silent exits of the transport", function () {
    it("sends nothing and answers nothing where the instance has mail disabled (spec 5.4: a skipped value after ticket 2)", async function () {
      given({ instance: instance({ mailEnabled: false }) });

      const answer = await mail.sendBookingConfirmation([stored("B-1")], {
        attachments: [],
      });

      expect(answer).to.equal(undefined);
      expect(sent).to.have.length(0);
    });

    it("sends nothing and answers skipped where there is no recipient", async function () {
      given();

      const answer = await MailerService.send({
        type: "test",
        tenantId: TENANT,
        to: "",
        subject: "Ohne Empfänger",
        html: "<p>x</p>",
      });

      expect(answer).to.deep.equal({
        status: "skipped",
        reason: "no_recipient",
      });
      expect(sent).to.have.length(0);
    });
  });
});
