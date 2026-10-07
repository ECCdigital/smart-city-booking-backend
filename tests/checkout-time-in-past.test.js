/**
 * A self-booking cannot start in the past (ECCdigital/tickets#188): every
 * entrance of the self-booking refuses a begin before now with the reason
 * `checkout.time_in_past` - v1 with `400`, v2 in its own shape - and
 * stores nothing; the administration's manual booking still books
 * backwards.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  TENANT,
  CUSTOMER,
  ADMIN,
  DAY,
  adminForm,
} = require("./helpers/booking-lifecycle-harness");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const {
  runTimeInPastCheck,
} = require("../src/commons/availability/checkout-availability-checks");
const {
  CHECK_TYPES,
} = require("../src/commons/availability/checkout-check-types");

const HOUR = 60 * 60 * 1000;

// A begin in June 2024, as reported from Süderbrarup.
const PAST_BEGIN = Date.UTC(2024, 5, 14, 10, 0, 0);
const PAST_END = PAST_BEGIN + 2 * HOUR;

describe("checkout: a self-booking cannot start in the past", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const post = (path, body) => h.api().post(path).send(body);
  const past = { timeBegin: PAST_BEGIN, timeEnd: PAST_END };

  it("the v1 checkout refuses it with 400 and stores nothing", async function () {
    const before = h.store.size;

    const res = await post(
      `/api/${TENANT}/checkout`,
      checkoutBody("room", past),
    );

    expect(res.status).to.equal(400);
    expect(res.text).to.equal(CHECKOUT_REASONS.TIME_IN_PAST);
    expect(h.store.size).to.equal(before);
  });

  it("the v1 validation refuses it with 400", async function () {
    const res = await post(`/api/${TENANT}/checkout/validateItem`, {
      bookableId: "room",
      amount: 1,
      ...past,
    });

    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal(CHECKOUT_REASONS.TIME_IN_PAST);
  });

  it("a begin earlier today is refused as well", async function () {
    const begin = Date.now() - HOUR;

    const res = await post(
      `/api/${TENANT}/checkout`,
      checkoutBody("room", { timeBegin: begin, timeEnd: begin + 2 * HOUR }),
    );

    expect(res.status).to.equal(400);
    expect(res.text).to.equal(CHECKOUT_REASONS.TIME_IN_PAST);
  });

  it("the v1 series refuses a past slot", async function () {
    const before = h.store.size;
    const slot = (timeBegin, timeEnd) => ({
      timeBegin,
      timeEnd,
      bookableItems: [
        { bookableId: "room", amount: 1, bookable: { id: "room" } },
      ],
    });

    const res = await post(`/api/${TENANT}/checkout/group`, {
      bookingAttempts: [
        slot(PAST_BEGIN, PAST_END),
        slot(PAST_BEGIN + DAY, PAST_END + DAY),
      ],
      contactData: { name: "Erika Muster", mail: CUSTOMER },
      paymentProvider: "giroCockpit",
    });

    expect(res.status).to.equal(400);
    expect(h.store.size).to.equal(before);
  });

  it("the v2 checkout and its validation refuse it with the reason", async function () {
    const before = h.store.size;

    const checkout = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", past),
    );
    expect(checkout.body.success).to.equal(false);
    expect(checkout.body.error.reason).to.equal(CHECKOUT_REASONS.TIME_IN_PAST);
    expect(h.store.size).to.equal(before);

    const validate = await post(`/api/v2/${TENANT}/checkout/validate/room`, {
      start: PAST_BEGIN,
      end: PAST_END,
      amount: 1,
    });
    expect(validate.body.success).to.equal(false);
    expect(validate.body.error.reason).to.equal(CHECKOUT_REASONS.TIME_IN_PAST);
  });

  it("a validation names a conflict before the begin in the past", async function () {
    // The staff's booking form validates a backwards booking over the
    // self-booking's validation; what it shows is the conflict.
    const res = await post(`/api/v2/${TENANT}/checkout/validate/room`, {
      start: PAST_BEGIN,
      end: PAST_END,
      amount: 11,
    });

    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(
      CHECKOUT_REASONS.BOOKABLE_UNAVAILABLE,
    );
  });

  it("the occupancy answers a past window as not available", async function () {
    const res = await h
      .api()
      .get(`/api/${TENANT}/bookables/room/occupancy`)
      .query({ timeBegin: PAST_BEGIN, timeEnd: PAST_END });

    expect(res.status).to.equal(200);
    expect(res.body.isAvailable).to.equal(false);
  });

  it("a future begin books as before", async function () {
    const before = h.store.size;

    const res = await post(`/api/v2/${TENANT}/checkout`, checkoutBody("room"));

    expect(res.body.success).to.equal(true);
    expect(h.store.size).to.equal(before + 1);
  });

  it("the administration's manual booking still books backwards", async function () {
    const booking = await h.manualBooking("room", {}, past);

    expect(h.stored(booking.id)).to.exist;
    expect(h.stored(booking.id).timeBegin).to.equal(PAST_BEGIN);
  });

  it("the administration moves a booking backwards", async function () {
    const booking = await h.manualBooking("room");
    const earlier = { timeBegin: PAST_BEGIN - DAY, timeEnd: PAST_END - DAY };

    const res = await h
      .api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(booking.id), earlier));

    expect(res.status).to.equal(201);
    expect(h.stored(booking.id).timeBegin).to.equal(earlier.timeBegin);
  });
});

describe("runTimeInPastCheck", function () {
  const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
  const room = { id: "room", title: "Raum", isScheduleRelated: true };

  it("lets a begin at or after now pass", function () {
    expect(
      runTimeInPastCheck({ originBookable: room, timeBegin: NOW, now: NOW })
        .available,
    ).to.equal(true);
  });

  it("refuses a begin a minute before now", function () {
    expect(() =>
      runTimeInPastCheck({
        originBookable: room,
        timeBegin: NOW - 60 * 1000,
        now: NOW,
      }),
    )
      .to.throw()
      .that.includes({
        checkType: CHECK_TYPES.TIME_IN_PAST,
        reason: CHECKOUT_REASONS.TIME_IN_PAST,
      });
  });

  it("checks nothing for a bookable without a booking period", function () {
    const item = { id: "item", title: "Beamer" };

    expect(
      runTimeInPastCheck({ originBookable: item, timeBegin: 0, now: NOW })
        .available,
    ).to.equal(true);
    expect(
      runTimeInPastCheck({ originBookable: room, timeBegin: null, now: NOW })
        .available,
    ).to.equal(true);
  });
});
