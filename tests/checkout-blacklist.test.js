/**
 * The checkout refuses an address on the blacklist (glossary „Blacklist“,
 * ECCdigital/tickets#627): every self-booking - v1 and v2, single, group
 * and bundle, as a guest and signed in - asks the blacklist for each
 * address of `mail` before anything is stored and before any payment, and
 * refuses the whole booking on a hit with `checkout.address_blacklisted`
 * and the instance's `mailAddress`. The administration's manual booking
 * books anyway; the bookings already stored stay as they are.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  adminForm,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const {
  BlacklistEntryKind,
} = require("../src/commons/schemas/blacklistEntrySchema");

const BLOCKED = "max@firma.test";
const OPERATOR = "betrieb@example.test";
const REASON = CHECKOUT_REASONS.ADDRESS_BLACKLISTED;
// Confirmed at once and to be paid: a booking that got through would ask
// the payment provider.
const PAID = "auto-room";

const entry = (value, kind = BlacklistEntryKind.ADDRESS) => ({
  id: `entry-${value}`,
  value,
  kind,
  reason: "Missbrauch",
  createdAt: new Date("2026-10-01T00:00:00Z"),
});

describe("checkout: an address on the blacklist", function () {
  this.timeout(20000);

  let h;

  beforeEach(async function () {
    h = await installHarness();
    h.instance.mailAddress = OPERATOR;
    h.blacklist.push(entry(BLOCKED));
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

  const v2Group = (mail) => ({
    bookableItems: [{ bookableId: PAID, amount: 1 }],
    bookingAttempts: [
      { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
      { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
    ],
    name: "Max Muster",
    mail,
    paymentProvider: "giroCockpit",
  });

  const slot = (timeBegin, timeEnd) => ({
    timeBegin,
    timeEnd,
    bookableItems: [{ bookableId: PAID, amount: 1, bookable: { id: PAID } }],
  });

  const v1Group = (mail) => ({
    bookingAttempts: [
      slot(TIME_BEGIN, TIME_END),
      slot(TIME_BEGIN + DAY, TIME_END + DAY),
    ],
    contactData: { name: "Max Muster", mail },
    paymentProvider: "giroCockpit",
  });

  const bundle = (mail) =>
    checkoutBody(PAID, {
      mail,
      bookableItems: [
        { bookableId: PAID, amount: 1 },
        { bookableId: "free-room", amount: 1 },
      ],
    });

  /** The v2 answer of a refusal: 200, `success: false`, the reason. */
  const refusedV2 = (res) => {
    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(REASON);
    expect(res.body.error.params).to.deep.equal({ mailAddress: OPERATOR });
  };

  /** The v1 answer of a refusal: 409, as its other refusals, and the reason as text. */
  const refusedV1 = (res) => {
    expect(res.status).to.equal(409);
    expect(res.text).to.equal(REASON);
  };

  const cases = [
    {
      name: "v2 single",
      send: (mail, user) =>
        post(`/api/v2/${TENANT}/checkout`, checkoutBody(PAID, { mail }), user),
      refused: refusedV2,
    },
    {
      name: "v2 bundle",
      send: (mail, user) =>
        post(`/api/v2/${TENANT}/checkout`, bundle(mail), user),
      refused: refusedV2,
    },
    {
      name: "v2 group",
      send: (mail, user) =>
        post(`/api/v2/${TENANT}/checkout/group`, v2Group(mail), user),
      refused: refusedV2,
    },
    {
      name: "v1 single",
      send: (mail, user) =>
        post(`/api/${TENANT}/checkout`, checkoutBody(PAID, { mail }), user),
      refused: refusedV1,
    },
    {
      name: "v1 bundle",
      send: (mail, user) => post(`/api/${TENANT}/checkout`, bundle(mail), user),
      refused: refusedV1,
    },
    {
      name: "v1 group",
      send: (mail, user) =>
        post(`/api/${TENANT}/checkout/group`, v1Group(mail), user),
      refused: refusedV1,
    },
  ];

  const principals = [
    ["as a guest", undefined],
    ["signed in", CUSTOMER],
  ];

  for (const { name, send, refused } of cases) {
    for (const [as, user] of principals) {
      it(`${name} ${as}: refuses, stores nothing and pays nothing`, async function () {
        const res = await send(BLOCKED, user);

        refused(res);
        expect(h.store.size).to.equal(0);
        expect(h.groups.size).to.equal(0);
        expect(h.takeEffects()).to.deep.equal([]);
      });
    }

    it(`${name}: books an address the blacklist does not hit`, async function () {
      const res = await send("anna@firma.test");

      expect(res.status).to.equal(200);
      expect(h.store.size).to.be.greaterThan(0);
    });
  }

  it("asks for every address of `mail`: one hit refuses the whole booking", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody(PAID, { mail: `anna@firma.test, ${BLOCKED}` }),
    );

    refusedV2(res);
    expect(h.store.size).to.equal(0);
    expect(h.takeEffects()).to.deep.equal([]);
  });

  it("reads the addresses separated by line breaks, trimmed and in any case", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", { mail: `anna@firma.test\n  MAX@Firma.test ` }),
    );

    refusedV2(res);
    expect(h.store.size).to.equal(0);
  });

  it("several addresses without a hit book", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", { mail: "anna@firma.test, ben@firma.test" }),
    );

    expect(res.body.success).to.equal(true);
    expect(h.store.size).to.equal(1);
  });

  it("a domain entry refuses every address of the domain, no subdomain", async function () {
    h.blacklist.push(entry("@wegwerf.test", BlacklistEntryKind.DOMAIN));

    const hit = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", { mail: "irgendwer@wegwerf.test" }),
    );
    refusedV2(hit);

    const sub = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", { mail: "irgendwer@mail.wegwerf.test" }),
    );
    expect(sub.body.success).to.equal(true);
  });

  it("refuses a simulated checkout the same way", async function () {
    const res = await post(
      `/api/v2/${TENANT}/checkout?simulate=true`,
      checkoutBody("room", { mail: BLOCKED }),
    );

    refusedV2(res);
  });

  it("an instance without a mail address answers an empty one", async function () {
    h.instance.mailAddress = "";

    const res = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", { mail: BLOCKED }),
    );

    expect(res.body.error.reason).to.equal(REASON);
    expect(res.body.error.params).to.deep.equal({ mailAddress: "" });
  });

  it("the administration's manual booking books the address anyway", async function () {
    const booking = await h.manualBooking("room", {}, { mail: BLOCKED });

    expect(h.stored(booking.id).mail).to.equal(BLOCKED);
  });

  it("a booking already stored with the address stays as it is and can be edited", async function () {
    h.blacklist.length = 0;
    const booking = await h.manualBooking("room", {}, { mail: BLOCKED });
    h.blacklist.push(entry(BLOCKED));
    const before = JSON.parse(JSON.stringify(h.stored(booking.id)));

    const refused = await post(
      `/api/v2/${TENANT}/checkout`,
      checkoutBody("room", {
        mail: BLOCKED,
        timeBegin: TIME_BEGIN + DAY,
        timeEnd: TIME_END + DAY,
      }),
    );
    refusedV2(refused);
    expect(h.store.size).to.equal(1);
    expect(JSON.parse(JSON.stringify(h.stored(booking.id)))).to.deep.equal(
      before,
    );

    const edited = await h
      .api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(booking.id), { comment: "geändert" }));
    expect(edited.status).to.equal(201);
    expect(h.stored(booking.id).comment).to.equal("geändert");
  });
});
