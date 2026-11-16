/**
 * The mails about customer uploads to the staff,
 * over `compose` + `send`, the fixture of the mail characterization and the
 * in-memory transport: the tenant's notice of a new group names the proofs
 * handed in with the checkout per booking, the notice „Nachweis
 * eingereicht“ stays behind the tenant's switch, and no mail ever carries a
 * customer upload as its attachment - not even one an admin marked
 * `mailAttach`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const mailService = require("../src/commons/mail-service");
const MediaManager = require("../src/commons/data-managers/media-manager");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  TENANT,
  GROUP,
  GROUP_MEMBER_IDS,
  FRONTEND_URL,
  BACKEND_URL,
  SECRETARY,
  NOW,
  booking,
  tenant,
  room,
  ticket,
  groupMembers,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");

/** A reference of a booking to a customer upload handed in. */
const reference = (overrides = {}) => ({
  fieldId: "club-card",
  fieldLabel: "Vereinsausweis",
  mediaId: "M-upload",
  originalFileName: "ausweis-erika.pdf",
  uploadedAt: NOW - 60 * 1000,
  review: { status: "submitted" },
  ...overrides,
});

describe("mail: customer uploads to the staff", function () {
  let sent;
  let env;

  function given({ theTenant = tenant(), bookings } = {}) {
    installMailStackStore({
      tenant: theTenant,
      bookings: bookings ?? [booking(), ...groupMembers()],
      bookables: [room(), ticket()],
    });
    sent = installInMemoryMailTransport();
  }

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
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("INCOMING_BOOKING of a group names the proofs per booking, without a file name", async function () {
    const [first, second, third] = groupMembers();
    given({
      bookings: [
        booking(),
        { ...first, customerUploads: [reference()] },
        {
          ...second,
          customerUploads: [
            reference({ fieldId: "statute", fieldLabel: "Satzung" }),
          ],
        },
        third,
      ],
    });

    await mail.send("INCOMING_BOOKING", {
      tenantId: TENANT,
      bookingIds: GROUP_MEMBER_IDS,
      groupBookingId: GROUP,
    });

    expect(sent).to.have.length(1);
    const { html } = sent[0];
    expect(html).to.include("Mit der Buchung eingereichte Nachweise");
    expect(html).to.match(/Vereinsausweis\s*\(Buchung G-1\)/);
    expect(html).to.match(/Satzung\s*\(Buchung G-2\)/);
    expect(html).to.not.include("G-3)");
    expect(html).to.not.include("ausweis-erika");
  });

  describe("CUSTOMER_UPLOAD_SUBMITTED", function () {
    const notice = () =>
      mailService.notify("CUSTOMER_UPLOAD_SUBMITTED", {
        tenantId: TENANT,
        bookingId: "B-1",
        fieldLabels: ["Vereinsausweis"],
      });

    const withUploads = (settings = {}, overrides = {}) =>
      tenant({
        customerUploads: {
          enabled: true,
          notifyRoleIds: ["role-pruefung"],
          ...settings,
        },
        ...overrides,
      });

    it("goes to the active members of the tenant's roles with the link to the booking and no attachment", async function () {
      given({ theTenant: withUploads() });

      await notice();

      // The fixture's role has one active member and one who left.
      expect(sent.map((mail) => mail.to)).to.deep.equal([SECRETARY]);
      expect(sent[0].attachments).to.deep.equal([]);
      expect(sent[0].html).to.include(
        `${FRONTEND_URL}/bookings/B-1?tenant&#x3D;${TENANT}`,
      );
    });

    it("stays off behind the tenant's switch, and without customer uploads", async function () {
      given({ theTenant: withUploads({ notifyOnSubmitted: false }) });
      await notice();
      expect(sent).to.deep.equal([]);

      sinon.restore();
      sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
      given({ theTenant: tenant() });
      await notice();
      expect(sent).to.deep.equal([]);
    });

    it("never goes to the tenant's address: without a role, to nobody", async function () {
      given({ theTenant: withUploads({ notifyRoleIds: [] }) });

      await notice();

      expect(sent).to.deep.equal([]);
    });

    it("goes whatever the notice of new bookings", async function () {
      given({ theTenant: withUploads({}, { notifyOnNewBooking: false }) });

      await notice();

      expect(sent).to.have.length(1);
    });
  });

  describe("no mail carries a customer upload", function () {
    it("leaves out a customer upload marked mailAttach, keeps the other documents", async function () {
      given({
        bookings: [
          booking({
            attachments: [
              ...booking().attachments,
              {
                id: "att-upload",
                title: "Vereinsausweis",
                type: "file",
                reference: { source: "media", mediaId: "M-upload" },
                mailAttach: true,
              },
            ],
          }),
        ],
      });
      const houseRules = await MediaManager.getMedia("M-house-rules");
      MediaManager.getMedia.callsFake(async (mediaId) =>
        mediaId === "M-upload"
          ? {
              id: mediaId,
              tenantId: TENANT,
              originalFileName: "ausweis-erika.pdf",
              mimeType: "application/pdf",
              tags: ["customerUpload"],
              bookingIds: ["B-1"],
              storage: { key: "stadthalle/media/M-upload/original.pdf" },
            }
          : mediaId === "M-house-rules"
            ? houseRules
            : null,
      );

      await mail.send("FREE_BOOKING_CONFIRMATION", {
        tenantId: TENANT,
        bookingIds: ["B-1"],
      });

      const names = sent[0].attachments.map((att) => att.filename);
      expect(names).to.include("Hausordnung.pdf");
      expect(names.filter((name) => /ausweis|Vereinsausweis/.test(name))).to.be
        .empty;
    });
  });
});
