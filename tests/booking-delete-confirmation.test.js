/**
 * The confirmation of a deletion, held by the backend: a confirmed booking
 * and a paid one (`isPayed` with a price above 0 EUR, also once cancelled)
 * go only with `?confirmed=true`; without it the delete answers 409
 * `confirmation_required` and deletes nothing. A series is checked as a
 * whole by the backend, before any member goes.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  requiresConfirmation,
} = require("../src/commons/services/booking-lifecycle/booking-deletion");

describe("deleting a booking takes a confirmation where it is confirmed or paid", function () {
  this.timeout(20000);
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();
  const query = (confirmed) => (confirmed ? "?confirmed=true" : "");
  const deleteBooking = (id, confirmed = false) =>
    api()
      .delete(`/api/${TENANT}/bookings/${id}${query(confirmed)}`)
      .set(h.as(ADMIN));
  const deleteGroup = (id, confirmed = false) =>
    api()
      .delete(`/api/${TENANT}/group-bookings/${id}${query(confirmed)}`)
      .set(h.as(ADMIN));

  /**
   * A group of two priced slots, a day apart: requested for `room`,
   * awaiting payment for `auto-room`, which confirms itself.
   */
  async function group(bookableId = "room") {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout/group`)
      .set(h.as(CUSTOMER))
      .send({
        bookableItems: [{ bookableId, amount: 1 }],
        bookingAttempts: [
          { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
          { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
        ],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
      });
    expect(res.status).to.equal(200);
    return res.body.data.groupBooking.id;
  }

  const requestedGroup = () => group("room");

  async function confirmedGroup() {
    const id = await group("auto-room");
    const pay = await api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN));
    expect(pay.status).to.be.below(300);
    for (const memberId of h.groups.get(id).bookingIds) {
      expect(h.stored(memberId).status).to.equal("confirmed");
    }
    return id;
  }

  describe("a single booking", function () {
    it("refuses a confirmed booking without the flag with 409 confirmation_required, and keeps it", async function () {
      const booking = await h.manualBooking("room", {
        isCommitted: true,
        isPayed: true,
      });

      const res = await deleteBooking(booking.id);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("confirmation_required");
      expect(res.body.params.bookingIds).to.deep.equal([booking.id]);
      expect(h.stored(booking.id)).to.be.ok;
    });

    it("deletes a confirmed booking with the flag", async function () {
      const booking = await h.manualBooking("room", {
        isCommitted: true,
        isPayed: true,
      });

      const res = await deleteBooking(booking.id, true);

      expect(res.status).to.equal(200);
      expect(h.stored(booking.id)).to.not.be.ok;
    });

    it("refuses a paid booking that was cancelled without the flag", async function () {
      const booking = await h.manualBooking("room", {
        isCommitted: true,
        isPayed: true,
      });
      const cancel = await api()
        .post(`/api/${TENANT}/bookings/${booking.id}/reject`)
        .set(h.as(ADMIN))
        .send({});
      expect(cancel.status).to.be.below(300);
      expect(h.stored(booking.id).status).to.equal("cancelled");

      const res = await deleteBooking(booking.id);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("confirmation_required");
    });

    it("deletes a requested booking without the flag", async function () {
      const booking = await h.manualBooking("room", { status: "requested" });

      const res = await deleteBooking(booking.id);

      expect(res.status).to.equal(200);
      expect(h.stored(booking.id)).to.not.be.ok;
    });
  });

  describe("a series", function () {
    it("refuses a confirmed series without the flag, naming its members, and keeps every one", async function () {
      const id = await confirmedGroup();
      const memberIds = h.groups.get(id).bookingIds;

      const res = await deleteGroup(id);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("confirmation_required");
      expect(res.body.params.bookingIds).to.have.members(memberIds);
      for (const memberId of memberIds) {
        expect(h.stored(memberId)).to.be.ok;
      }
    });

    it("deletes a confirmed series with the flag", async function () {
      const id = await confirmedGroup();
      const memberIds = h.groups.get(id).bookingIds;

      const res = await deleteGroup(id, true);

      expect(res.status).to.equal(200);
      for (const memberId of memberIds) {
        expect(h.stored(memberId)).to.not.be.ok;
      }
    });

    it("deletes a requested series without the flag", async function () {
      const id = await requestedGroup();
      const memberIds = h.groups.get(id).bookingIds;

      const res = await deleteGroup(id);

      expect(res.status).to.equal(200);
      for (const memberId of memberIds) {
        expect(h.stored(memberId)).to.not.be.ok;
      }
    });
  });

  describe("which booking requires it", function () {
    it("a confirmed one, whatever its price", function () {
      expect(requiresConfirmation({ status: "confirmed", priceEur: 0 })).to.be
        .true;
    });

    it("a paid one with a price, also cancelled or withdrawn", function () {
      for (const status of ["cancelled", "withdrawn"]) {
        expect(
          requiresConfirmation({ status, isPayed: true, priceEur: 25 }),
        ).to.equal(true);
      }
    });

    it("not a free one that reads as paid, nor an unpaid one", function () {
      expect(
        requiresConfirmation({
          status: "requested",
          isPayed: true,
          priceEur: 0,
        }),
      ).to.equal(false);
      expect(
        requiresConfirmation({
          status: "payment_due",
          isPayed: false,
          priceEur: 25,
        }),
      ).to.equal(false);
      expect(
        requiresConfirmation({
          status: "cancelled",
          isPayed: false,
          priceEur: 25,
        }),
      ).to.equal(false);
    });
  });
});
