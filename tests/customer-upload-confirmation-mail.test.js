/**
 * The missing proofs in the booker's confirmation:
 * the notices confirming a booking name each required upload field the
 * customer still has to hand in, with its deadline and a button „Jetzt
 * einreichen“ to the storefront's page „Nachweise einreichen“ - never with
 * an attachment of a customer upload. Without a required field missing,
 * or with customer uploads off, they name nothing. Over `compose` + `send`,
 * the fixture of the mail characterization and the in-memory transport.
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
  NOW,
  booking,
  tenant,
  room,
  ticket,
  groupMembers,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");

const STORE_FRONT_URL = "https://shop.example.test";
const HEADING = "Folgende Nachweise fehlen noch";

/** The links of a mail as a client reads them, its entities decoded. */
const linksOf = (html) =>
  [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
    href.replace(/&#x3D;/g, "=").replace(/&amp;/g, "&"),
  );

/** An upload field of the room, required and "after the confirmation". */
const uploadField = (overrides = {}) => ({
  id: "club-card",
  label: "Vereinsausweis",
  hint: "",
  consentText: "",
  required: true,
  formats: ["pdf"],
  category: "normal",
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
  ...overrides,
});

const withUploads = (overrides = {}) =>
  tenant({ customerUploads: { enabled: true }, ...overrides });

const roomWith = (fields) => room({ uploadFieldDefinitions: fields });

/** A reference of the booking to an upload of the field. */
const reference = (status, overrides = {}) => ({
  fieldId: "club-card",
  fieldLabel: "Vereinsausweis",
  mediaId: "M-upload",
  originalFileName: "ausweis-erika.pdf",
  uploadedAt: NOW - 60 * 1000,
  review: { status },
  ...overrides,
});

describe("mail: the missing proofs in the confirmation", function () {
  let sent;
  let env;

  function given({
    tenant: theTenant = withUploads(),
    fields = [uploadField()],
    references = [],
    status = "confirmed",
  } = {}) {
    installMailStackStore({
      tenant: theTenant,
      bookings: [
        booking({ status, customerUploads: references }),
        ...groupMembers(),
      ],
      bookables: [roomWith(fields), ticket()],
    });
    sent = installInMemoryMailTransport();
  }

  const single = (specific = {}) => ({
    tenantId: TENANT,
    bookingIds: ["B-1"],
    ...specific,
  });

  beforeEach(function () {
    env = {
      FRONTEND_URL: process.env.FRONTEND_URL,
      BACKEND_URL: process.env.BACKEND_URL,
      STORE_FRONT_URL: process.env.STORE_FRONT_URL,
    };
    process.env.FRONTEND_URL = FRONTEND_URL;
    process.env.BACKEND_URL = BACKEND_URL;
    process.env.STORE_FRONT_URL = STORE_FRONT_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  for (const type of ["BOOKING_CONFIRMATION", "FREE_BOOKING_CONFIRMATION"]) {
    it(`${type} names the missing proof with its deadline and the button`, async function () {
      given();
      await mail.send(type, single());

      expect(sent).to.have.length(1);
      const { html } = sent[0];
      expect(html).to.include(HEADING);
      expect(html).to.include("Vereinsausweis");
      // Seven days before the start on 05.10.2026, 10:00 Berlin.
      expect(html).to.include("bis 28.09.2026, 10:00");
      expect(html).to.include("Jetzt einreichen");
      expect(linksOf(html)).to.include(
        `${STORE_FRONT_URL}/account/proofs?booking=B-1&field=club-card`,
      );
    });
  }

  it("names a rejected and an overdue proof, not one waiting for its check", async function () {
    given({
      fields: [
        uploadField(),
        uploadField({
          id: "pass",
          label: "Sozialpass",
          deadlineDaysBeforeStart: 40,
        }),
        uploadField({ id: "letter", label: "Bescheinigung" }),
      ],
      references: [
        reference("rejected", {
          review: { status: "rejected", reviewedAt: NOW - 1000 },
        }),
        reference("submitted", {
          fieldId: "letter",
          fieldLabel: "Bescheinigung",
        }),
      ],
    });
    await mail.send("BOOKING_CONFIRMATION", single());

    const { html } = sent[0];
    expect(html).to.include("Vereinsausweis");
    expect(html).to.include("Sozialpass");
    expect(html).to.not.include("Bescheinigung");
  });

  it("never attaches a customer upload nor names its file", async function () {
    given({
      fields: [
        uploadField(),
        uploadField({ id: "letter", label: "Bescheinigung" }),
      ],
      references: [
        reference("submitted", {
          fieldId: "letter",
          fieldLabel: "Bescheinigung",
        }),
      ],
    });
    await mail.send("BOOKING_CONFIRMATION", single());

    const { html, attachments } = sent[0];
    expect(html).to.include(HEADING);
    expect(html).to.not.include("ausweis-erika.pdf");
    expect(attachments.map((attachment) => attachment.filename)).to.not.include(
      "ausweis-erika.pdf",
    );
  });

  it("names nothing once every required proof is handed in or checked", async function () {
    given({
      references: [
        reference("accepted", {
          review: { status: "accepted", reviewedAt: NOW },
        }),
      ],
    });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(HEADING);
  });

  it("names nothing for an optional field", async function () {
    given({ fields: [uploadField({ required: false })] });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(HEADING);
  });

  it("names nothing with customer uploads off at the tenant", async function () {
    given({ tenant: tenant() });
    await mail.send("BOOKING_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(HEADING);
  });

  it("names nothing of a field after the confirmation while the booking is a request", async function () {
    given({ status: "requested" });
    await mail.send("BOOKING_REQUEST_CONFIRMATION", single());
    expect(sent[0].html).to.not.include(HEADING);
  });

  it("names nothing in a notice that does not confirm, such as the cancellation", async function () {
    given({ status: "cancelled" });
    await mail.send("BOOKING_CANCEL", single({ reason: "Fällt aus" }));
    expect(sent[0].html).to.not.include(HEADING);
  });

  it("names the booking of each line in the notice of a group", async function () {
    given();
    await mail.send("BOOKING_CONFIRMATION", {
      tenantId: TENANT,
      bookingIds: GROUP_MEMBER_IDS,
      groupBookingId: GROUP,
    });

    const { html } = sent[0];
    expect(html).to.include(HEADING);
    // G-1 and G-2 book the room, G-3 the ticket without upload fields.
    expect(html).to.include("(Buchung G-1)");
    expect(html).to.include("(Buchung G-2)");
    expect(html).to.not.include("(Buchung G-3)");
    expect(linksOf(html)).to.include(
      `${STORE_FRONT_URL}/account/proofs?booking=G-1`,
    );
  });
});
