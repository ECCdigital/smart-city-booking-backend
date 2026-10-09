/**
 * `GET /api/:tenant/group-bookings/booking/:bookingId`: the group a booking
 * belongs to. The Admin UI asks it on every booking page. A booking without
 * a group is the common case, not a failure, so it answers `200` with
 * `null` instead of a `404` that lands in the browser console and the logs.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");

describe("GET /group-bookings/booking/:bookingId", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const groupOf = (bookingId, userId) =>
    h
      .api()
      .get(`/api/${TENANT}/group-bookings/booking/${bookingId}?populate=true`)
      .set(h.as(userId));

  async function seedGroup(bookingIds) {
    await GroupBookingManager.storeGroupBooking({
      id: "G-BY-BOOKING",
      tenantId: TENANT,
      bookingIds,
      assignedUserId: ADMIN,
      mail: ADMIN,
    });
  }

  it("answers 200 with null for a booking without a group", async function () {
    const booking = await h.manualBooking("room");

    const res = await groupOf(booking.id, ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body).to.equal(null);
  });

  it("answers 200 with null for a booking that does not exist", async function () {
    const res = await groupOf("no-such-booking", ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body).to.equal(null);
  });

  it("answers the group, its members populated, for a member", async function () {
    const booking = await h.manualBooking("room");
    await seedGroup([booking.id]);

    const res = await groupOf(booking.id, ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body.id).to.equal("G-BY-BOOKING");
    expect(res.body.bookings.map((b) => b.id)).to.deep.equal([booking.id]);
  });

  it("answers a group outside the reach like no group at all", async function () {
    const booking = await h.manualBooking("room");
    await seedGroup([booking.id]);

    const res = await groupOf(booking.id, CUSTOMER);

    expect(res.status).to.equal(200);
    expect(res.body).to.equal(null);
  });
});
