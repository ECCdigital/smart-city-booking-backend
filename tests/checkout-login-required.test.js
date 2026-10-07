/**
 * The checkout of an offer behind a login (`requiresLogin`,
 * ECCdigital/tickets#123): the completion refuses a customer who is not
 * signed in with 401 and `checkout.login_required` and stores nothing -
 * v1 and v2, single and group - also where the offer names no permitted
 * users or roles. The pre-check of the permissions keeps answering the
 * same reason with 200.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");

describe("checkout: an offer behind a login", function () {
  this.timeout(20000);

  let h;

  beforeEach(async function () {
    h = await installHarness({
      bookables: {
        "login-room": bookable({
          id: "login-room",
          title: "Raum mit Anmeldung",
          requiresLogin: true,
        }),
      },
    });
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const post = (path, body, userId) => {
    let req = h.api().post(path);
    if (userId) req = req.set(h.as(userId));
    return req.send(body);
  };

  it("the v2 checkout refuses an anonymous customer with 401 and stores nothing", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("login-room"),
    );

    expect(res.status).to.equal(401);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
    expect(h.store.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("the legacy checkout refuses an anonymous customer with 401 and stores nothing", async function () {
    const res = await post(
      `/api/${TENANT}/checkout`,
      checkoutBody("login-room"),
    );

    expect(res.status).to.equal(401);
    expect(res.text).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
    expect(h.store.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("the v2 group checkout refuses an anonymous customer with 401 and stores nothing", async function () {
    const res = await post(`/api/v2/${TENANT}/checkout/group`, {
      bookableItems: [{ bookableId: "login-room", amount: 1 }],
      bookingAttempts: [
        { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
        { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
      ],
      name: "Erika Muster",
      mail: CUSTOMER,
      paymentProvider: "giroCockpit",
    });

    expect(res.status).to.equal(401);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
    expect(h.store.size).to.equal(0);
    expect(h.groups.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("the legacy group checkout stores no attempt when a later one is behind a login", async function () {
    const slot = (bookableId, timeBegin, timeEnd) => ({
      timeBegin,
      timeEnd,
      bookableItems: [{ bookableId, amount: 1, bookable: { id: bookableId } }],
    });

    const res = await post(`/api/${TENANT}/checkout/group`, {
      bookingAttempts: [
        slot("room", TIME_BEGIN, TIME_END),
        slot("login-room", TIME_BEGIN + DAY, TIME_END + DAY),
      ],
      contactData: { name: "Erika Muster", mail: CUSTOMER },
      paymentProvider: "giroCockpit",
    });

    expect(res.status).to.equal(401);
    expect(res.text).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
    expect(h.store.size).to.equal(0);
    expect(h.groups.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("refuses a cart in which another item is behind a login", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", {
        bookableItems: [
          { bookableId: "room", amount: 1 },
          { bookableId: "login-room", amount: 1 },
        ],
      }),
    );

    expect(res.status).to.equal(401);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
    expect(h.store.size).to.equal(0);
  });

  it("refuses a simulated checkout the same way", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout?simulate=true`,
      checkoutBody("login-room"),
    );

    expect(res.status).to.equal(401);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
  });

  it("a signed-in customer books the offer, v2 and legacy", async function () {
    const v2 = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("login-room"),
      CUSTOMER,
    );
    expect(v2.status).to.equal(200);
    expect(v2.body.success).to.equal(true);
    expect(h.stored(v2.body.data.booking.id).assignedUserId).to.equal(CUSTOMER);

    const v1 = await post(
      `/api/${TENANT}/checkout`,
      checkoutBody("login-room", {
        timeBegin: TIME_BEGIN + DAY,
        timeEnd: TIME_END + DAY,
      }),
      CUSTOMER,
    );
    expect(v1.status).to.equal(200);
    expect(h.stored(v1.body.id).assignedUserId).to.equal(CUSTOMER);
  });

  it("an offer without a login stays open to an anonymous customer", async function () {
    const res = await post(`/api/v2/${TENANT}/checkout`, checkoutBody("room"));

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(h.store.size).to.equal(1);
  });

  it("the pre-check keeps answering 200 with the reason", async function () {
    const anonymous = await h
      .api()
      .get(`/api/v2/${TENANT}/checkout/permissions/login-room`);
    expect(anonymous.status).to.equal(200);
    expect(anonymous.body.success).to.equal(false);
    expect(anonymous.body.error.reason).to.equal(
      CHECKOUT_REASONS.LOGIN_REQUIRED,
    );

    const signedIn = await h
      .api()
      .get(`/api/v2/${TENANT}/checkout/permissions/login-room`)
      .set(h.as(CUSTOMER));
    expect(signedIn.status).to.equal(200);
    expect(signedIn.body.success).to.equal(true);
  });

  it("an offer the public cannot reach is not there, not behind a login", async function () {
    h.tenant.supervisionLevel = "pending";

    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("login-room"),
    );

    expect(res.status).to.equal(200);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.BOOKABLE_NOT_FOUND);
    expect(h.store.size).to.equal(0);
  });

  it("the administration's manual booking stays open", async function () {
    const booking = await h.manualBooking("login-room");

    expect(h.stored(booking.id)).to.exist;
  });
});
