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

const OCCUPANCY = `/api/${TENANT}/bookables/occupancy`;

describe("occupancy of many bookables in one period", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
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

  for (const [name, body] of [
    ["no ids", { bookableIds: [], timeBegin: TIME_BEGIN, timeEnd: TIME_END }],
    ["no period", { bookableIds: ["room"] }],
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
});
