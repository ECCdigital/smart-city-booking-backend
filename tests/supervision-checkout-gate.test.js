/**
 * The supervision gate in the checkout (tenant supervision spec §5.2): a
 * new self-booking of a blocked tenant is refused at every entrance - v1
 * and v2, single and group, validation - signed in or not, a ticket of an
 * event included; the administration's manual booking stays open.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
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

describe("supervision: the checkout gate", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    h.tenant.supervisionLevel = "blocked";
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
  });

  const post = (path, body, userId) => {
    let req = h.api().post(path);
    if (userId) req = req.set(h.as(userId));
    return req.send(body);
  };

  it("the v2 checkout refuses the booking with a reason and stores nothing", async function () {
    const res = await post(`/api/v2/${TENANT}/checkout`, checkoutBody("room"));

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    );
    expect(h.store.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("signing in does not open it", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room"),
      CUSTOMER,
    );

    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    );
  });

  it("a ticket of an event is refused the same way", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("ticket", { timeBegin: null, timeEnd: null }),
    );

    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    );
  });

  it("the v2 validation and group entrances refuse it too", async function () {
    const validate = await post(`/api/v2/${TENANT}/checkout/validate/room`, {
      start: TIME_BEGIN,
      end: TIME_END,
      amount: 1,
    });
    expect(validate.body.success).to.equal(false);
    expect(validate.body.error.reason).to.equal(
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    );

    const groupBody = {
      bookableItems: [{ bookableId: "room", amount: 1 }],
      bookingAttempts: [
        { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
        { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
      ],
      name: "Erika Muster",
      mail: CUSTOMER,
      paymentProvider: "giroCockpit",
    };
    const group = await post(`/api/v2/${TENANT}/checkout/group`, groupBody);
    expect(group.body.success).to.equal(false);
    expect(group.body.error.reason).to.equal(
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    );
    const validateGroup = await post(
      `/api/v2/${TENANT}/checkout/validate-group`,
      groupBody,
    );
    // The group validation answers per slot: every slot is refused.
    expect(validateGroup.body.data.allValid).to.equal(false);
    expect(
      validateGroup.body.data.attempts.map((a) => a.error?.reason),
    ).to.deep.equal([
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
      CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
    ]);
    expect(h.store.size).to.equal(0);
  });

  it("the legacy checkout form is refused as well", async function () {
    const single = await post(`/api/${TENANT}/checkout`, checkoutBody("room"));
    expect(single.status).to.equal(409);
    expect(h.store.size).to.equal(0);

    const validate = await post(`/api/${TENANT}/checkout/validateItem`, {
      bookableId: "room",
      amount: 1,
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });
    expect(validate.status).to.equal(409);

    const slot = (timeBegin, timeEnd) => ({
      timeBegin,
      timeEnd,
      bookableItems: [
        { bookableId: "room", amount: 1, bookable: { id: "room" } },
      ],
    });
    const group = await post(`/api/${TENANT}/checkout/group`, {
      bookingAttempts: [
        slot(TIME_BEGIN, TIME_END),
        slot(TIME_BEGIN + DAY, TIME_END + DAY),
      ],
      contactData: { name: "Erika Muster", mail: CUSTOMER },
      paymentProvider: "giroCockpit",
    });
    expect(group.status).to.not.equal(200);
    expect(h.store.size).to.equal(0);
  });

  it("the administration's manual booking stays open", async function () {
    const booking = await h.manualBooking("room");

    expect(h.stored(booking.id)).to.exist;
  });

  it("a free tenant books as before", async function () {
    h.tenant.supervisionLevel = "free";

    const res = await post(`/api/v2/${TENANT}/checkout`, checkoutBody("room"));

    expect(res.body.success).to.equal(true);
    expect(h.store.size).to.equal(2);
  });
});
