/**
 * The CSV of an event's attendee list has the column "Nachweise":
 * the least favourable state of a booking's
 * required proofs, in words, for whoever may export the list - no file
 * names, no links.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const BookingManager = require("../src/commons/data-managers/booking-manager");

const DAY = 24 * 60 * 60 * 1000;

const PROOF_FIELD = {
  id: "field-proof",
  label: "Vereinsausweis",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

describe("the proofs in the attendee list CSV", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      tenant: {
        customerUploads: { enabled: true, formats: ["pdf"], retentionDays: 30 },
      },
      bookables: {
        "proof-ticket": bookable({
          id: "proof-ticket",
          title: "Ticket mit Nachweis",
          uploadFieldDefinitions: [PROOF_FIELD],
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  afterEach(function () {
    BookingManager.getEventBookings.callsFake(async () => []);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const booking = (id, fields) => ({
    id,
    tenantId: TENANT,
    status: "confirmed",
    bookableItems: [{ bookableId: "proof-ticket", amount: 1 }],
    timeBegin: Date.now() + 30 * DAY,
    timeEnd: Date.now() + 31 * DAY,
    mail: `${id}@example.org`,
    assignedUserId: `${id}@example.org`,
    ...fields,
  });

  const reference = (status) => ({
    mediaId: `m-${status}`,
    fieldId: PROOF_FIELD.id,
    fieldLabel: PROOF_FIELD.label,
    originalFileName: "ausweis-geheim.pdf",
    uploadedAt: Date.now() - DAY,
    review:
      status === "submitted"
        ? undefined
        : { status, reviewedAt: Date.now(), reason: "" },
  });

  const exportCsv = async () => {
    const res = await h
      .api()
      .get(`/csv/${TENANT}/events/${FIXTURE_ID}/bookings`)
      .set(h.as(ROLE_HOLDER))
      .send();
    expect(res.status).to.equal(200);
    const text = res.text.replace(/^﻿/, "");
    const [header, ...lines] = text.split("\r\n");
    const columns = header.split(";");
    return {
      text,
      columns,
      rows: lines.map((line) => {
        const cells = line.split(";");
        return Object.fromEntries(columns.map((c, i) => [c, cells[i]]));
      }),
    };
  };

  it("names the least favourable state of each booking", async function () {
    BookingManager.getEventBookings.resolves([
      booking("b-missing"),
      booking("b-overdue", {
        timeBegin: Date.now() + 2 * DAY,
        timeEnd: Date.now() + 3 * DAY,
      }),
      booking("b-review", { customerUploads: [reference("submitted")] }),
      booking("b-done", { customerUploads: [reference("accepted")] }),
      booking("b-requested", { status: "requested" }),
    ]);

    const { columns, rows } = await exportCsv();

    expect(columns).to.include("Nachweise");
    const proofs = Object.fromEntries(
      rows.map((r) => [r.Buchungsnummer, r.Nachweise]),
    );
    expect(proofs).to.deep.equal({
      "b-missing": "Fehlt",
      "b-overdue": "Überfällig",
      "b-review": "Zu prüfen",
      "b-done": "Erfüllt",
      // A field "after the confirmation" is not open for a request yet.
      "b-requested": "",
    });
  });

  it("names no file and no link", async function () {
    BookingManager.getEventBookings.resolves([
      booking("b-review", { customerUploads: [reference("submitted")] }),
    ]);

    const { text } = await exportCsv();

    expect(text).not.to.include("ausweis-geheim.pdf");
    expect(text).not.to.include("m-submitted");
  });
});
