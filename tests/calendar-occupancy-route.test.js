/**
 * `GET /api/:tenant/calendar/occupancy?ids=…` with several bookables
 * (ECCdigital/tickets#795): the embed's occupancy calendar sends the ids
 * comma-separated in one parameter, with or without a blank after the
 * comma. Every bookable named is in the answer, as with the ids given as
 * a repeated parameter.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
} = require("./helpers/booking-lifecycle-harness");
const BookingManager = require("../src/commons/data-managers/booking-manager");

const OCCUPANCY = `/api/${TENANT}/calendar/occupancy`;

/** One booking per bookable, each in its own hour. */
const BOOKINGS = {
  room: { id: "b-room", timeBegin: 1000, timeEnd: 2000 },
  "auto-room": { id: "b-auto-room", timeBegin: 3000, timeEnd: 4000 },
};

describe("calendar occupancy of several bookables by id", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
    sinon
      .stub(BookingManager, "getRelatedBookingsBatch")
      .callsFake(async (tenantId, bookableIds) =>
        bookableIds
          .filter((id) => BOOKINGS[id])
          .map((id) => ({
            ...BOOKINGS[id],
            tenant: tenantId,
            isRejected: false,
            bookableItems: [{ bookableId: id }],
          })),
      );
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const bookableIdsOf = (res) =>
    res.body.map((occupancy) => occupancy.bookableId).sort();

  for (const query of [
    "ids=room,auto-room",
    "ids=room,%20auto-room",
    "ids=room&ids=auto-room",
  ]) {
    it(`answers every bookable of ${query}`, async function () {
      const res = await h.api().get(`${OCCUPANCY}?${query}`);

      expect(res.status).to.equal(200);
      expect(bookableIdsOf(res)).to.deep.equal(["auto-room", "room"]);
    });
  }

  it("answers only the bookable of a single id", async function () {
    const res = await h.api().get(`${OCCUPANCY}?ids=room`);

    expect(res.status).to.equal(200);
    expect(bookableIdsOf(res)).to.deep.equal(["room"]);
  });
});
