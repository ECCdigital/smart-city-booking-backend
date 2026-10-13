/**
 * The CSV of an event's attendee list names each booking's Buchungsweg in
 * words, next to the column "Angemeldeter Benutzer" (`assignedUserId`).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const BookingManager = require("../src/commons/data-managers/booking-manager");

describe("the Buchungsweg in the attendee list CSV", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness();
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  afterEach(function () {
    // The route world answers an event without bookings; put that back.
    BookingManager.getEventBookings.callsFake(async () => []);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const booking = (id, fields) => ({
    id,
    tenantId: TENANT,
    bookableItems: [],
    mail: `${id}@example.org`,
    assignedUserId: `${id}@example.org`,
    ...fields,
  });

  const exportRows = async () => {
    const res = await h
      .api()
      .get(`/csv/${TENANT}/events/${FIXTURE_ID}/bookings`)
      .set(h.as(ROLE_HOLDER))
      .send();
    expect(res.status).to.equal(200);
    const [header, ...lines] = res.text.replace(/^﻿/, "").split("\r\n");
    const columns = header.split(";");
    return {
      columns,
      rows: lines.map((line) => {
        const cells = line.split(";");
        return Object.fromEntries(columns.map((c, i) => [c, cells[i]]));
      }),
    };
  };

  it("has the column Buchungsweg right after Angemeldeter Benutzer", async function () {
    BookingManager.getEventBookings.resolves([
      booking("b-user", { bookedVia: "user" }),
    ]);

    const { columns } = await exportRows();

    expect(columns.indexOf("Angemeldeter Benutzer")).to.equal(
      columns.indexOf("Anzahl") + 1,
    );
    expect(columns.indexOf("Buchungsweg")).to.equal(
      columns.indexOf("Angemeldeter Benutzer") + 1,
    );
  });

  it("names the Buchungsweg of each booking in words", async function () {
    BookingManager.getEventBookings.resolves([
      booking("b-user", { bookedVia: "user" }),
      booking("b-guest", { bookedVia: "guest" }),
      booking("b-admin", { bookedVia: "admin" }),
      booking("b-old", {}),
      booking("b-odd", { bookedVia: "somewhere" }),
    ]);

    const { rows } = await exportRows();

    const bookedVia = Object.fromEntries(
      rows.map((r) => [r.Buchungsnummer, r.Buchungsweg]),
    );
    expect(bookedVia).to.deep.equal({
      "b-user": "Userkonto",
      "b-guest": "Gast",
      "b-admin": "Admin",
      "b-old": "Unbekannt",
      "b-odd": "Unbekannt",
    });
  });
});
