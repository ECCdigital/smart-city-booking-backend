/**
 * The participation link of an online or hybrid event in the booker's mails
 * (ECCdigital/tickets#180): the notices confirming a booking, paid or free,
 * name it once the booking is confirmed, and so does their calendar file;
 * the request, the open payment, the rejection and the cancellation do not.
 * Every notice of a ticket names the format, and an online event has no
 * address line. Over `compose` + `send`, the fixture of the mail
 * characterization and the in-memory transport.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  TENANT,
  GROUP,
  GROUP_MEMBER_IDS,
  FRONTEND_URL,
  BACKEND_URL,
  booking,
  concert,
  groupMembers,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");

const LINK = "https://meet.example.test/herbstkonzert";

/** A booking of two tickets for the concert. */
const ticketBooking = (overrides = {}) =>
  booking({
    id: "T-1",
    comment: "",
    coupon: null,
    customFields: [],
    attachments: [],
    bookableItems: [{ bookableId: "ticket", amount: 2 }],
    timeBegin: null,
    timeEnd: null,
    ...overrides,
  });

const online = (overrides = {}) =>
  concert({
    format: 2,
    eventLocation: { name: "", url: LINK },
    location: { address: {} },
    ...overrides,
  });

const hybrid = (overrides = {}) =>
  concert({
    format: 1,
    eventLocation: { name: "Großer Saal", url: LINK },
    ...overrides,
  });

describe("mail: the participation link of an online or hybrid event", function () {
  let sent;
  let env;

  function given({ status = "confirmed", event = online() } = {}) {
    installMailStackStore({
      bookings: [ticketBooking({ status }), ...groupMembers()],
      events: [event],
    });
    sent = installInMemoryMailTransport();
  }

  const single = (specific = {}) => ({
    tenantId: TENANT,
    bookingIds: ["T-1"],
    ...specific,
  });

  const calendarOf = (message) =>
    message.attachments
      .find((attachment) => attachment.filename.endsWith(".ics"))
      .content.toString("utf-8")
      // iCal folds long lines; unfold for reading.
      .replace(/\r?\n[ \t]/g, "");

  beforeEach(function () {
    env = {
      FRONTEND_URL: process.env.FRONTEND_URL,
      BACKEND_URL: process.env.BACKEND_URL,
    };
    process.env.FRONTEND_URL = FRONTEND_URL;
    process.env.BACKEND_URL = BACKEND_URL;
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env.FRONTEND_URL;
    process.env.BACKEND_URL = env.BACKEND_URL;
  });

  for (const type of ["BOOKING_CONFIRMATION", "FREE_BOOKING_CONFIRMATION"]) {
    it(`${type} of a confirmed booking names the link, in the mail and in its calendar file`, async function () {
      given();
      await mail.send(type, single());
      expect(sent).to.have.length(1);
      expect(sent[0].html).to.include(`href="${LINK}"`);
      expect(calendarOf(sent[0])).to.include(LINK);
    });
  }

  it("names the link of a hybrid event too", async function () {
    given({ event: hybrid() });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.include(`href="${LINK}"`);
  });

  it("names no link of an event in presence, a stale one left in the field", async function () {
    given({ event: concert({ format: 0, eventLocation: { url: LINK } }) });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(LINK);
    expect(calendarOf(sent[0])).to.not.include(LINK);
  });

  const withoutLink = [
    ["BOOKING_REQUEST_CONFIRMATION", "requested", {}],
    [
      "PAYMENT_LINK_AFTER_APPROVAL",
      "payment_due",
      { paymentUrl: "https://pay.example.test/1" },
    ],
    ["INVOICE_AFTER_APPROVAL", "payment_due", {}],
    ["BOOKING_CONFIRMED_INVOICE_PENDING", "payment_due", {}],
    ["BOOKING_REJECTION", "rejected", { reason: "Ausgebucht" }],
    ["BOOKING_CANCEL", "cancelled", { reason: "Fällt aus" }],
  ];
  for (const [type, status, specific] of withoutLink) {
    it(`${type} (${status}) names no link`, async function () {
      given({ status });
      await mail.send(type, single(specific));
      expect(sent).to.have.length.of.at.least(1);
      for (const message of sent) {
        expect(message.html).to.not.include(LINK);
        const calendar = message.attachments.find((attachment) =>
          attachment.filename.endsWith(".ics"),
        );
        if (calendar) expect(calendarOf(message)).to.not.include(LINK);
      }
    });
  }

  it("a confirmation sent again for a cancelled booking names no link", async function () {
    given({ status: "cancelled" });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(LINK);
  });

  it("the group confirmation names the link at the ticket member", async function () {
    installMailStackStore({ events: [online()] });
    sent = installInMemoryMailTransport();
    await mail.send("BOOKING_CONFIRMATION", {
      tenantId: TENANT,
      bookingIds: GROUP_MEMBER_IDS,
      groupBookingId: GROUP,
    });
    expect(sent).to.have.length(1);
    expect(sent[0].html).to.include(`href="${LINK}"`);
  });

  it("names the format, and an online event without an address line", async function () {
    given();
    await mail.send("BOOKING_REQUEST_CONFIRMATION", single());
    expect(sent[0].html).to.include("Format: Online");
    expect(sent[0].html).to.not.include("Ort:");
  });

  it("names the format and the address of a hybrid event without empty parts", async function () {
    given({
      event: hybrid({
        location: { address: { city: "Musterstadt" } },
      }),
    });
    await mail.send("BOOKING_REQUEST_CONFIRMATION", single());
    expect(sent[0].html).to.include("Format: Hybrid");
    expect(sent[0].html).to.include("Ort: Großer Saal, Musterstadt");
  });
});
