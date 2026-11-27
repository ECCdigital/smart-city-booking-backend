/**
 * The payment state of a booking cancelled before it was paid: the share
 * kept is still owed, `open` from the cancellation on, until the
 * administration marks it received. Runs on the lifecycle harness, as the
 * refund state does.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  installHarness,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");

describe("the payment state of a booking cancelled unpaid", function () {
  let h;
  let clock;

  const NOW = Date.UTC(2027, 0, 15, 9, 0, 0);

  beforeEach(async function () {
    h = await installHarness();
    clock = sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
    // The harness keeps the refund state's write in memory; the payment
    // state's, by the same rule, here: a booking with a payment state not
    // yet in the asked one matches.
    sinon
      .stub(BookingManager, "setPaymentState")
      .callsFake(async (tenantId, id, state) => {
        const doc = h.stored(id);
        const current = doc?.cancellationRefund?.paymentState;
        if (!doc || current === undefined || current === state.paymentState) {
          return null;
        }
        const refund = { ...doc.cancellationRefund };
        refund.paymentState = state.paymentState;
        if (state.paymentState === "completed") {
          refund.paymentCompletedAt = state.completedAt;
          refund.paymentCompletedByUserId = state.completedByUserId;
        } else {
          delete refund.paymentCompletedAt;
          delete refund.paymentCompletedByUserId;
        }
        doc.cancellationRefund = refund;
        return { ...doc };
      });
  });

  afterEach(async function () {
    clock.restore();
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  async function checkout() {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room"));
    expect(res.status).to.equal(200);
    return res.body.data.booking.id;
  }

  const pay = (id) =>
    api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN)).send({});
  const cancel = (id, refundPercentage) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send({ refundPercentage });
  const setPaymentState = (id, paymentState, user = ADMIN) =>
    api()
      .put(`/api/${TENANT}/bookings/${id}/payment-state`)
      .set(h.as(user))
      .send({ paymentState });

  /** Cancelled before it was paid, half kept: half the price is owed. */
  async function cancelledOwingBooking() {
    const id = await checkout();
    expect((await cancel(id, 50)).status).to.equal(200);
    return id;
  }

  it("is open where an unpaid booking's cancellation keeps a share", async function () {
    const id = await cancelledOwingBooking();

    const refund = h.stored(id).cancellationRefund;
    expect(refund.paymentState).to.equal("open");
    expect(refund.cancellationFeeEur).to.be.above(0);
    expect(refund).to.not.have.property("refundState");
  });

  it("is not there where nothing is kept, nor on a paid booking", async function () {
    const keptNothing = await checkout();
    await cancel(keptNothing, 100);
    const paid = await checkout();
    await pay(paid);
    await cancel(paid, 50);

    for (const id of [keptNothing, paid]) {
      expect(h.stored(id).cancellationRefund).to.not.have.property(
        "paymentState",
      );
    }
  });

  it("marks the payment received, with the moment and the person, and takes it back", async function () {
    const id = await cancelledOwingBooking();

    const res = await setPaymentState(id, "completed");

    expect(res.status).to.equal(200);
    expect(h.stored(id).cancellationRefund).to.include({
      paymentState: "completed",
      paymentCompletedAt: NOW,
      paymentCompletedByUserId: ADMIN,
    });
    expect(h.stored(id).status).to.equal("cancelled");

    expect((await setPaymentState(id, "open")).status).to.equal(200);
    const refund = h.stored(id).cancellationRefund;
    expect(refund.paymentState).to.equal("open");
    expect(refund).to.not.have.property("paymentCompletedAt");
  });

  it("answers 409 without a payment state, 400 for another value, 403 for the booker", async function () {
    const owing = await cancelledOwingBooking();
    const live = await checkout();

    const conflict = await setPaymentState(live, "completed");
    expect(conflict.status).to.equal(409);
    expect(conflict.body).to.include({ code: "payment_state_not_applicable" });

    const invalid = await setPaymentState(owing, "paid");
    expect(invalid.status).to.equal(400);
    expect(invalid.body).to.include({ code: "invalid_payment_state" });

    expect(
      (await setPaymentState(owing, "completed", CUSTOMER)).status,
    ).to.equal(403);
    expect(h.stored(owing).cancellationRefund.paymentState).to.equal("open");
  });
});
