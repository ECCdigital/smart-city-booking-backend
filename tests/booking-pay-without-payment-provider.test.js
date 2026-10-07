/**
 * „Als bezahlt markieren“ for a booking without a payment provider
 * (ECCdigital/tickets#187). Bookings from before the payment provider
 * became required (backend `v3.5.12`) carry a price but none; the
 * administration records a transfer or cash payment by hand, where the
 * provider plays no part. The payment provider is required only of an
 * unpaid booking with a price. Runs on the lifecycle harness
 * (`helpers/booking-lifecycle-harness.js`): the real routers, controllers,
 * lifecycle and entity validation over an in-memory store.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  adminForm,
  stateOf,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");

describe("marking a booking paid without a payment provider", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A priced booking awaiting payment, stored as an old one: no provider. */
  async function oldBookingAwaitingPayment() {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room"));
    expect(res.status).to.equal(200);
    const id = res.body.data.booking.id;
    h.stored(id).paymentProvider = "";
    expect(stateOf(h.stored(id))).to.equal("payment_due");
    expect(h.stored(id).priceEur).to.be.above(0);
    h.clearEffects();
    return id;
  }

  /** A priced series awaiting payment, its members stored without provider. */
  async function oldSeriesAwaitingPayment() {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout/group`)
      .set(h.as(CUSTOMER))
      .send({
        bookableItems: [{ bookableId: "auto-room", amount: 1 }],
        bookingAttempts: [
          { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
          { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
        ],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
      });
    expect(res.status).to.equal(200);
    const id = res.body.data.groupBooking.id;
    for (const member of h.members(id)) {
      member.paymentProvider = "";
    }
    expect(h.members(id).map(stateOf)).to.deep.equal([
      "payment_due",
      "payment_due",
    ]);
    h.clearEffects();
    return id;
  }

  it("marks a single booking paid by transfer: 200, paid, still without a provider", async function () {
    const id = await oldBookingAwaitingPayment();

    const res = await api()
      .post(`/api/${TENANT}/bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({ paymentMethod: "TRANSFER" });

    expect(res.status).to.equal(200);
    expect(stateOf(h.stored(id))).to.equal("confirmed");
    expect(h.stored(id)).to.include({
      isPayed: true,
      paymentMethod: "TRANSFER",
      paymentProvider: "",
    });
    expect(h.takeEffects()).to.include("store.save B1 confirmed");
  });

  it("marks a series paid by transfer: 200, every member paid", async function () {
    const id = await oldSeriesAwaitingPayment();

    const res = await api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({ paymentMethod: "TRANSFER" });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(h.members(id).map(stateOf)).to.deep.equal([
      "confirmed",
      "confirmed",
    ]);
    for (const member of h.members(id)) {
      expect(member).to.include({
        isPayed: true,
        paymentMethod: "TRANSFER",
        paymentProvider: "",
      });
    }
  });

  it("names the reason when the booking does not pass its schema: 400 with the field, nothing stored", async function () {
    const id = await oldBookingAwaitingPayment();
    h.stored(id).mail = "";

    const res = await api()
      .post(`/api/${TENANT}/bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({ paymentMethod: "TRANSFER" });

    expect(res.status).to.equal(400);
    expect(res.body).to.deep.include({
      error: "ValidationError",
      statusCode: 400,
    });
    expect(res.body.details).to.deep.equal([
      { field: "mail", code: "required", params: {} },
    ]);
    expect(stateOf(h.stored(id))).to.equal("payment_due");
  });

  it("names the reason for a series too", async function () {
    const id = await oldSeriesAwaitingPayment();
    h.members(id)[1].mail = "";

    const res = await api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({ paymentMethod: "TRANSFER" });

    expect(res.status).to.equal(400);
    expect(res.body.details).to.deep.equal([
      { field: "mail", code: "required", params: {} },
    ]);
    expect(h.members(id).map(stateOf)).to.deep.equal([
      "payment_due",
      "payment_due",
    ]);
  });

  it("still requires the provider of an unpaid booking with a price", async function () {
    const id = await oldBookingAwaitingPayment();

    const res = await api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(id), { comment: "nachgefragt" }));

    expect(res.status).to.equal(400);
    expect(JSON.stringify(res.body)).to.include("paymentProvider");
    expect(h.stored(id).comment).to.not.equal("nachgefragt");
  });

  it("keeps a paid booking without a provider editable", async function () {
    const id = await oldBookingAwaitingPayment();
    await api()
      .post(`/api/${TENANT}/bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({ paymentMethod: "TRANSFER" });

    const res = await api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(id), { comment: "bar bezahlt" }));

    expect(res.status).to.equal(201);
    expect(h.stored(id)).to.include({
      comment: "bar bezahlt",
      isPayed: true,
      paymentProvider: "",
    });
  });
});
