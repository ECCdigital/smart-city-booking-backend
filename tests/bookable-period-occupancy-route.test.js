/**
 * `POST /api/:tenant/bookables/occupancy`: the storefront's search with a
 * period asks the occupancy of many bookables in one request, each with the
 * price of the period where it is available, instead of two requests per
 * bookable.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  CHECK_TYPES,
} = require("../src/commons/availability/checkout-check-types");
const BookableService = require("../src/commons/services/bookable-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");

const OCCUPANCY = `/api/${TENANT}/bookables/occupancy`;

describe("occupancy of many bookables in one period", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
    installInMemoryRateLimitEvents();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
    delete process.env.RATE_LIMIT_PERIOD_OCCUPANCY_PER_IP;
  });

  const post = (body) => h.api().post(OCCUPANCY).send(body);

  it("answers each bookable with its availability and the period's price", async function () {
    const res = await post({
      bookableIds: ["room", "auto-room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.status).to.equal(200);
    expect(res.body.map((o) => o.bookableId).sort()).to.deep.equal([
      "auto-room",
      "room",
    ]);
    const room = res.body.find((o) => o.bookableId === "room");
    expect(room.isAvailable).to.equal(true);
    expect(room.price).to.include.keys(
      "regularPriceEur",
      "userGrossPriceEur",
      "freeBookingAllowed",
    );
  });

  it("leaves out ids it does not find, as the single occupancy answers them 404", async function () {
    const res = await post({
      bookableIds: ["room", "missing"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.status).to.equal(200);
    expect(res.body.map((o) => o.bookableId)).to.deep.equal(["room"]);
  });

  it("answers an unavailable bookable without a price", async function () {
    const res = await post({
      bookableIds: ["room"],
      timeBegin: TIME_BEGIN - 365 * 24 * 60 * 60 * 1000 * 10,
      timeEnd: TIME_END - 365 * 24 * 60 * 60 * 1000 * 10,
    });

    expect(res.status).to.equal(200);
    expect(res.body[0].isAvailable).to.equal(false);
    expect(res.body[0].price).to.equal(null);
  });

  // The shapes `runParentAvailabilityCheck` and `runChildBookingsCheck` throw.
  for (const [name, refusal] of [
    [
      "parent",
      {
        checkType: CHECK_TYPES.PARENT_AVAILABILITY,
        available: false,
        parentAvailability: [
          {
            bookableId: "hidden-parent",
            title: "Verborgen",
            totalCapacity: 1,
            booked: 1,
            remaining: 0,
            isAvailable: false,
          },
        ],
      },
    ],
    [
      "child",
      {
        checkType: CHECK_TYPES.CHILD_BOOKINGS,
        available: false,
        bookableId: "hidden-child",
        title: "Verborgen",
        totalCapacity: 1,
        booked: 1,
        remaining: 0,
      },
    ],
  ]) {
    it(`names neither id nor title of a ${name} that refuses the period`, async function () {
      sinon
        .stub(
          ItemCheckoutService.prototype,
          name === "parent" ? "checkParentAvailability" : "checkChildBookings",
        )
        .rejects(refusal);

      const res = await post({
        bookableIds: ["room"],
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      });

      expect(res.status).to.equal(200);
      expect(res.body[0]).to.include({
        bookableId: "room",
        title: "Raum",
        isAvailable: false,
        reason: refusal.checkType,
        price: null,
      });
      expect(res.body[0]).to.not.have.property("failedCheck");
      expect(JSON.stringify(res.body)).to.not.match(/hidden-|Verborgen/);
    });

    it(`names the refusal of a ${name} on the single occupancy, without its id or title`, async function () {
      sinon
        .stub(
          ItemCheckoutService.prototype,
          name === "parent" ? "checkParentAvailability" : "checkChildBookings",
        )
        .rejects(refusal);

      const res = await h
        .api()
        .get(`/api/${TENANT}/bookables/room/occupancy`)
        .query({ timeBegin: TIME_BEGIN, timeEnd: TIME_END });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        bookableId: "room",
        title: "Raum",
        isAvailable: false,
        reason: refusal.checkType,
      });
      expect(res.body.failedCheck).to.include({
        totalCapacity: 1,
        booked: 1,
        remaining: 0,
      });
      expect(JSON.stringify(res.body)).to.not.match(/hidden-|Verborgen/);
    });
  }

  describe("reason", function () {
    const ask = () =>
      post({ bookableIds: ["room"], timeBegin: TIME_BEGIN, timeEnd: TIME_END });

    it("names the check that refuses, also one without occupancy data", async function () {
      sinon.stub(ItemCheckoutService.prototype, "checkOpeningHours").rejects({
        checkType: CHECK_TYPES.OPENING_HOURS,
        available: false,
      });

      const res = await ask();

      expect(res.body[0]).to.include({
        isAvailable: false,
        reason: CHECK_TYPES.OPENING_HOURS,
      });
    });

    it("is error where the checkout cannot start", async function () {
      sinon
        .stub(ItemCheckoutService.prototype, "init")
        .rejects(new Error("Tenant tenant-1 has no active app"));

      const res = await ask();

      expect(res.status).to.equal(200);
      expect(res.body[0]).to.include({
        bookableId: "room",
        title: "Raum",
        isAvailable: false,
        reason: "error",
        price: null,
      });
    });

    it("is error where a check throws instead of refusing", async function () {
      sinon
        .stub(ItemCheckoutService.prototype, "checkAvailability")
        .rejects(new Error("provider timeout"));

      const res = await ask();

      expect(res.body[0]).to.include({ isAvailable: false, reason: "error" });
    });

    it("keeps the refusal where one check refuses and another throws", async function () {
      sinon
        .stub(ItemCheckoutService.prototype, "checkAvailability")
        .rejects(new Error("provider timeout"));
      sinon.stub(ItemCheckoutService.prototype, "checkOpeningHours").rejects({
        checkType: CHECK_TYPES.OPENING_HOURS,
        available: false,
      });

      const res = await ask();

      expect(res.body[0]).to.include({
        isAvailable: false,
        reason: CHECK_TYPES.OPENING_HOURS,
      });
    });

    it("is absent where the bookable is available", async function () {
      const res = await ask();

      expect(res.body[0].isAvailable).to.equal(true);
      expect(res.body[0]).to.not.have.property("reason");
    });
  });

  for (const [name, body] of [
    ["no ids", { bookableIds: [], timeBegin: TIME_BEGIN, timeEnd: TIME_END }],
    ["no period", { bookableIds: ["room"] }],
    // `Number()` would read these as 0, a period from 1970 on.
    ...[null, "", false, [], [TIME_BEGIN], String(TIME_BEGIN)].map(
      (timeBegin) => [
        `a begin of ${JSON.stringify(timeBegin)}`,
        { bookableIds: ["room"], timeBegin, timeEnd: TIME_END },
      ],
    ),
    [
      "an end of null",
      { bookableIds: ["room"], timeBegin: TIME_BEGIN, timeEnd: null },
    ],
    [
      "an end before the begin",
      { bookableIds: ["room"], timeBegin: TIME_END, timeEnd: TIME_BEGIN },
    ],
    [
      "more than 100 ids",
      {
        bookableIds: Array.from({ length: 101 }, (_, i) => `b${i}`),
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      },
    ],
  ]) {
    it(`refuses ${name} with 400`, async function () {
      const res = await post(body);

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_period_occupancy_request");
    });
  }

  it("answers a failure in the error handler's JSON, as it answers the 400", async function () {
    sinon
      .stub(BookableService, "getPeriodOccupancies")
      .rejects(new Error("database down"));

    const res = await post({
      bookableIds: ["room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.status).to.equal(500);
    expect(res.type).to.equal("application/json");
    expect(res.body).to.deep.equal({
      error: "InternalError",
      code: "internal_error",
      statusCode: 500,
    });
  });

  describe("limit per IP, counted in bookables", function () {
    // 100 ids, as the storefront asks at most; one of them is found.
    const hundredIds = [
      "room",
      ...Array.from({ length: 99 }, (_, i) => `b${i}`),
    ];
    const askHundred = () =>
      post({
        bookableIds: hundredIds,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      });

    it("answers 429 with Retry-After past the limit and starts no checkout", async function () {
      process.env.RATE_LIMIT_PERIOD_OCCUPANCY_PER_IP = "150";

      const first = await askHundred();
      expect(first.status).to.equal(200);

      // The harness stubs the lookup already.
      const lookup = BookableManager.getBookablesByIds;
      lookup.resetHistory();
      const checkout = sinon.spy(ItemCheckoutService.prototype, "init");
      const second = await askHundred();

      expect(second.status).to.equal(429);
      expect(second.body.code).to.equal("too_many_requests");
      expect(Number(second.headers["retry-after"])).to.be.within(1, 300);
      expect(lookup.called).to.equal(false);
      expect(checkout.called).to.equal(false);
    });

    it("answers a request with few ids under the limit as before", async function () {
      process.env.RATE_LIMIT_PERIOD_OCCUPANCY_PER_IP = "150";
      await askHundred();

      const res = await post({
        bookableIds: ["room", "auto-room"],
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(2);
    });

    it("counts an id the request names twice once", async function () {
      process.env.RATE_LIMIT_PERIOD_OCCUPANCY_PER_IP = "2";

      const res = await post({
        bookableIds: ["room", "auto-room", "room"],
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      });

      expect(res.status).to.equal(200);
    });

    it("spends nothing on a request it refuses with 400", async function () {
      process.env.RATE_LIMIT_PERIOD_OCCUPANCY_PER_IP = "100";

      const invalid = await post({ bookableIds: hundredIds });
      const valid = await askHundred();

      expect(invalid.status).to.equal(400);
      expect(valid.status).to.equal(200);
    });
  });

  it("answers the occupancies as a bare array", async function () {
    const res = await post({
      bookableIds: ["room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.type).to.equal("application/json");
    expect(res.body).to.be.an("array");
  });
});
