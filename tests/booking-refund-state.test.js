/**
 * The refund state of a cancelled booking (glossary "Erstattungsstand")
 * through the HTTP form: the administration marks the refund of a cancelled,
 * paid booking as completed and takes that back, the booking list filters by
 * it, and the booker never sees it. Runs on the lifecycle harness
 * (`helpers/booking-lifecycle-harness.js`): the real routers, controllers
 * and lifecycle over an in-memory store.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");

describe("the refund state of a cancelled booking", function () {
  let h;
  let clock;

  const NOW = Date.UTC(2027, 0, 15, 9, 0, 0);

  beforeEach(async function () {
    h = await installHarness();
    clock = sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(async function () {
    clock.restore();
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  async function checkout(bookableId) {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody(bookableId));
    expect(res.status).to.equal(200);
    return res.body.data.booking.id;
  }

  const pay = (id) =>
    api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN)).send({});
  const reject = (id, body = {}) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send(body);
  const setRefundState = (id, refundState, user = ADMIN) =>
    api()
      .put(`/api/${TENANT}/bookings/${id}/refund-state`)
      .set(h.as(user))
      .send({ refundState });

  /** A paid booking, cancelled by the administration: its refund is open. */
  async function cancelledPaidBooking() {
    const id = await checkout("auto-room");
    await pay(id);
    expect((await reject(id)).status).to.equal(200);
    expect(h.stored(id).cancellationRefund.refundState).to.equal("open");
    return id;
  }

  /** A booking cancelled before it was paid: no refund, no refund state. */
  async function cancelledUnpaidBooking() {
    const id = await checkout("auto-room");
    expect((await reject(id)).status).to.equal(200);
    return id;
  }

  describe("PUT /bookings/:id/refund-state", function () {
    it("marks the refund as completed, with the moment and the person", async function () {
      const id = await cancelledPaidBooking();

      const res = await setRefundState(id, "completed");

      expect(res.status).to.equal(200);
      expect(res.body.cancellationRefund).to.include({
        refundState: "completed",
        refundCompletedAt: NOW,
        refundCompletedByUserId: ADMIN,
      });
      expect(h.stored(id).cancellationRefund).to.include({
        refundState: "completed",
        refundCompletedAt: NOW,
        refundCompletedByUserId: ADMIN,
        cancelledFrom: "confirmed",
        refundAmountEur: 40,
      });
      expect(h.stored(id).status).to.equal("cancelled");
    });

    it("takes the mark back: open again, moment and person gone", async function () {
      const id = await cancelledPaidBooking();
      await setRefundState(id, "completed");

      const res = await setRefundState(id, "open");

      expect(res.status).to.equal(200);
      const refund = h.stored(id).cancellationRefund;
      expect(refund.refundState).to.equal("open");
      expect(refund).to.not.have.property("refundCompletedAt");
      expect(refund).to.not.have.property("refundCompletedByUserId");
      expect(refund.refundAmountEur).to.equal(40);
    });

    it("keeps the first moment and person where the refund is marked completed again", async function () {
      const id = await cancelledPaidBooking();
      await setRefundState(id, "completed");
      clock.tick(60_000);

      const res = await setRefundState(id, "completed", ROLE_HOLDER);

      expect(res.status).to.equal(200);
      expect(h.stored(id).cancellationRefund).to.include({
        refundState: "completed",
        refundCompletedAt: NOW,
        refundCompletedByUserId: ADMIN,
      });
    });

    it("is open to whoever may update bookings, and to nobody else", async function () {
      const id = await cancelledPaidBooking();

      expect(
        (await setRefundState(id, "completed", ROLE_HOLDER)).status,
      ).to.equal(200);
      expect((await setRefundState(id, "open", CUSTOMER)).status).to.equal(403);
      const anonymous = await api()
        .put(`/api/${TENANT}/bookings/${id}/refund-state`)
        .send({ refundState: "open" });
      expect(anonymous.status).to.equal(401);
      expect(h.stored(id).cancellationRefund.refundState).to.equal("completed");
    });

    it("answers 409 for a booking without a refund state: cancelled unpaid, or not cancelled at all", async function () {
      const unpaid = await cancelledUnpaidBooking();
      const live = await checkout("auto-room");
      await pay(live);

      for (const id of [unpaid, live]) {
        const res = await setRefundState(id, "completed");

        expect(res.status).to.equal(409);
        expect(res.body).to.include({ code: "refund_state_not_applicable" });
        expect(h.stored(id).cancellationRefund?.refundState).to.equal(
          undefined,
        );
      }
    });

    it("answers 404 for a booking that is not there and 400 for a value that is no refund state", async function () {
      const id = await cancelledPaidBooking();

      const missing = await setRefundState("no-such-booking", "completed");
      expect(missing.status).to.equal(404);
      expect(missing.body).to.include({ code: "booking_not_found" });

      for (const value of ["paid", "", undefined, true]) {
        const res = await setRefundState(id, value);
        expect(res.status, String(value)).to.equal(400);
        expect(res.body).to.include({ code: "invalid_refund_state" });
      }
      expect(h.stored(id).cancellationRefund.refundState).to.equal("open");
    });
  });

  describe("GET /bookings?refundState=", function () {
    it("lists the bookings in that refund state, and every booking without the filter", async function () {
      const open = await cancelledPaidBooking();
      const completed = await cancelledPaidBooking();
      await setRefundState(completed, "completed");
      const without = await cancelledUnpaidBooking();

      const list = async (query = "") => {
        const res = await api()
          .get(`/api/${TENANT}/bookings${query}`)
          .set(h.as(ADMIN));
        expect(res.status).to.equal(200);
        return res.body.map((booking) => booking.id).sort();
      };

      expect(await list("?refundState=open")).to.deep.equal([open]);
      expect(await list("?refundState=completed")).to.deep.equal([completed]);
      expect(await list()).to.deep.equal([open, completed, without].sort());
    });

    it("answers 400 for a value that is no refund state", async function () {
      const res = await api()
        .get(`/api/${TENANT}/bookings?refundState=paid`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(400);
      expect(res.body).to.include({ code: "invalid_refund_state" });
    });
    it("tells the booker nothing: under own the filter matches no booking", async function () {
      const id = await cancelledPaidBooking();
      await setRefundState(id, "completed");

      for (const value of ["open", "completed"]) {
        const res = await api()
          .get(`/api/${TENANT}/bookings?refundState=${value}`)
          .set(h.as(CUSTOMER));

        expect(res.status).to.equal(200);
        expect(res.body, value).to.deep.equal([]);
      }
    });
  });

  describe("the booker", function () {
    it("reads their cancelled booking with the refund audit, without the refund state", async function () {
      const id = await cancelledPaidBooking();
      await setRefundState(id, "completed");

      const own = await api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(CUSTOMER));
      const list = await api()
        .get(`/api/${TENANT}/bookings`)
        .set(h.as(CUSTOMER));
      const admin = await api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(ADMIN));

      for (const booking of [own.body, list.body[0]]) {
        expect(booking.id).to.equal(id);
        expect(booking.cancellationRefund.refundAmountEur).to.equal(40);
        expect(booking.cancellationRefund).to.not.have.any.keys(
          "refundState",
          "refundCompletedAt",
          "refundCompletedByUserId",
        );
      }
      expect(admin.body.cancellationRefund.refundState).to.equal("completed");
    });
  });
});
