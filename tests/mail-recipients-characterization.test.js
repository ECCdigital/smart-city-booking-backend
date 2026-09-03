/**
 * Characterization of who gets a notice (glossary "Empfängerkreis"), seen
 * at the transport: the recipient rules of the mail module - the payment
 * link that goes to the booker, there being no address at the interface,
 * the BCC to the tenant, the tenant's gate on its own notice, the
 * supervisors without the booker, the organizers read off the bookables
 * of the booking, a list of bookings without a group refused, and the two
 * exits of the transport.
 *
 * Written for the first ticket of the mail-stack chain (Wayfinder,
 * "Mail-Stack (1): Charakterisierung ..."; spec sections 1 and 5) and
 * turned with ticket 3 where the spec changes a rule on purpose (5.1, 5.7).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const MailerService = require("../src/commons/mail-service/mail-service");
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const {
  SKIPPED,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const { BadRequestError } = require("../src/errors/BaseError");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  TENANT,
  TENANT_MAIL,
  GROUP,
  GROUP_MEMBER_IDS,
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
  concert,
  membership,
  installMailStackStore,
  issuedFile,
} = require("./helpers/mail-stack-fixtures");

describe("mail recipients today: who gets which notice", function () {
  let sent;
  let env;

  function given(options = {}) {
    installMailStackStore(options);
    sent = installInMemoryMailTransport();
  }

  const recipients = () => sent.map((entry) => entry.to);
  const single = (id, specific = {}) => ({
    tenantId: TENANT,
    bookingIds: [id],
    ...specific,
  });
  const group = (specific = {}) => ({
    tenantId: TENANT,
    bookingIds: GROUP_MEMBER_IDS,
    groupBookingId: GROUP,
    ...specific,
  });

  beforeEach(function () {
    env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env;
  });

  describe("the payment link after approval", function () {
    const paymentUrl = "https://pay.example.test/x";

    it("goes to the booker: there is no address at the interface (spec 5.1)", async function () {
      given();

      await mail.send(
        "PAYMENT_LINK_AFTER_APPROVAL",
        single("B-1", { paymentUrl }),
      );

      expect(recipients()).to.deep.equal([CUSTOMER]);
      expect(sent[0].html).to.include(paymentUrl);
    });

    it("of a group goes to the booker of its first member (spec 5.1)", async function () {
      given();

      await mail.send("PAYMENT_LINK_AFTER_APPROVAL", group({ paymentUrl }));

      expect(recipients()).to.deep.equal([CUSTOMER]);
    });
  });

  describe("the copy to the tenant (BCC)", function () {
    it("goes with a booking confirmation that carries a document, where the tenant wants receipts copied", async function () {
      given();

      await mail.send(
        "BOOKING_CONFIRMATION",
        single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
      );

      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("goes with a booking confirmation without a document too, because the iCal of a timed booking counts as one", async function () {
      given({ bookings: [booking({ attachments: [] })] });

      await mail.send("BOOKING_CONFIRMATION", single("B-1"));

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

      await mail.send("BOOKING_CONFIRMATION", single("B-1"));

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

      await mail.send(
        "BOOKING_CONFIRMATION",
        single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
      );

      expect(sent[0].bcc).to.equal(undefined);
    });

    it("always goes with a cancellation", async function () {
      given({ tenant: tenant({ receiptEnableBCC: false }) });

      await mail.send("BOOKING_CANCEL", single("B-cancelled", { reason: "" }));

      expect(sent[0].bcc).to.equal(TENANT_MAIL);
    });

    it("never goes with a free booking confirmation, documents or not", async function () {
      given();

      await mail.send(
        "FREE_BOOKING_CONFIRMATION",
        single("B-1", { attachments: [issuedFile("RE-1.pdf")] }),
      );

      expect(sent[0].bcc).to.equal(undefined);
    });
  });

  describe("the tenant's notice of a new booking", function () {
    it("goes to the tenant's address", async function () {
      given();

      const answer = await mail.send("INCOMING_BOOKING", single("B-1"));

      expect(answer).to.not.equal(SKIPPED);
      expect(recipients()).to.deep.equal([TENANT_MAIL]);
    });

    it("is skipped, nothing sent, where the tenant does not want one", async function () {
      given({ tenant: tenant({ notifyOnNewBooking: false }) });

      const answer = await mail.send("INCOMING_BOOKING", single("B-1"));

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });
  });

  describe("the supervisors' notice of a new booking", function () {
    it("goes to every recipient of the booker's membership - by address, by account, by role - once each, and never to the booker", async function () {
      given();

      await mail.send("SUPERVISOR_BOOKING_NOTIFICATION", single("B-1"));

      expect(recipients()).to.have.members([SUPERVISOR, SECRETARY]);
      expect(recipients()).to.not.include(BOOKER_USER);
      expect(sent.map((entry) => entry.bcc)).to.deep.equal([
        undefined,
        undefined,
      ]);
    });

    it("of a group is one mail per recipient", async function () {
      given();

      await mail.send("SUPERVISOR_BOOKING_NOTIFICATION", group());

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

      await mail.send("SUPERVISOR_BOOKING_NOTIFICATION", single("B-1"));

      expect(recipients()).to.deep.equal([SUPERVISOR]);
    });

    it("is skipped for a guest booking without an account", async function () {
      given({ bookings: [booking({ assignedUserId: "" })] });

      const answer = await mail.send(
        "SUPERVISOR_BOOKING_NOTIFICATION",
        single("B-1"),
      );

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });

    it("is skipped where the tenant has supervisor notices off", async function () {
      given({ tenant: tenant({ notifySupervisorsOnBooking: false }) });

      const answer = await mail.send(
        "SUPERVISOR_BOOKING_NOTIFICATION",
        single("B-1"),
      );

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });

    it("is skipped where the booker's membership names nobody", async function () {
      given({ membership: null });

      const answer = await mail.send(
        "SUPERVISOR_BOOKING_NOTIFICATION",
        single("B-1"),
      );

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });
  });

  describe("the organizers' notice of a new ticket booking", function () {
    /** The ticket booking: two positions of the ticket. */
    function ticketBooking(items) {
      return booking({
        id: "T-1",
        bookableItems: items,
      });
    }

    it("goes to the organizer of the event of every ticket position, read off the booking's bookables, once per organizer", async function () {
      const entity = ticketBooking([
        { bookableId: "ticket", amount: 1 },
        { bookableId: "ticket", amount: 2 },
      ]);
      given({ bookings: [entity] });

      await mail.send("NEW_BOOKING", single("T-1"));

      expect(recipients()).to.deep.equal([ORGANIZER]);
    });

    it("is skipped for a booking without a ticket position", async function () {
      const entity = ticketBooking([{ bookableId: "room", amount: 1 }]);
      given({ bookings: [entity] });

      const answer = await mail.send("NEW_BOOKING", single("T-1"));

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });

    it("is skipped where the event names no organizer address", async function () {
      const entity = ticketBooking([{ bookableId: "ticket", amount: 1 }]);
      given({
        bookings: [entity],
        events: [concert({ eventOrganizer: {} })],
      });

      const answer = await mail.send("NEW_BOOKING", single("T-1"));

      expect(answer).to.equal(SKIPPED);
      expect(sent).to.have.length(0);
    });
  });

  describe("a list of bookings without a group", function () {
    it("is refused as a programming error, nothing sent (spec 5.7: no fan-out)", async function () {
      given();

      let error;
      try {
        await mail.send("BOOKING_CONFIRMATION", {
          tenantId: TENANT,
          bookingIds: ["G-1", "G-2"],
          attachments: [issuedFile("RE-1.pdf")],
        });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(BadRequestError);
      expect(sent).to.have.length(0);
    });
  });

  describe("the exits of the transport", function () {
    it("sends nothing where the instance has mail disabled; the mail adapter answers skipped, so the effect row shows it (spec 5.4)", async function () {
      given({ instance: instance({ mailEnabled: false }) });

      const answer = await mail.send("BOOKING_CONFIRMATION", single("B-1"));

      expect(answer).to.equal(SKIPPED);
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
