/**
 * `POST /api/:tenant/bookables/occupancy` answers from the same check and
 * the same price as the single occupancy and `validateItem`, and reads its
 * bookables with one query - within the reach of the request, as before.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");

const OCCUPANCY = `/api/${TENANT}/bookables/occupancy`;

describe("occupancy of many bookables: one check, one read", function () {
  let h;

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const post = (body) => h.api().post(OCCUPANCY).send(body);

  it("answers availability and price as the single occupancy and validateItem do", async function () {
    // 10 EUR net per hour, 19 % VAT: 2 hours are 20 EUR net, 23.80 EUR gross.
    h = await installHarness({
      bookables: {
        "hour-room": bookable({
          id: "hour-room",
          title: "Raum (Stunde)",
          priceType: "per-hour",
          priceValueAddedTax: 19,
          priceCategories: [
            { priceEur: 10, interval: { start: null, end: null } },
          ],
        }),
      },
    });
    const price = {
      regularPriceEur: 20,
      userPriceEur: 20,
      regularGrossPriceEur: 23.8,
      userGrossPriceEur: 23.8,
      freeBookingAllowed: false,
      bookingDiscountPercent: 0,
    };
    const priceFields = (body) =>
      Object.fromEntries(Object.keys(price).map((key) => [key, body[key]]));

    const [batch] = (
      await post({
        bookableIds: ["hour-room"],
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      })
    ).body;
    const single = await h
      .api()
      .get(`/api/${TENANT}/bookables/hour-room/occupancy`)
      .query({ timeBegin: TIME_BEGIN, timeEnd: TIME_END });
    const v1 = await h.api().post(`/api/${TENANT}/checkout/validateItem`).send({
      bookableId: "hour-room",
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 1,
    });
    const v2 = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout/validate/hour-room`)
      .send({ start: TIME_BEGIN, end: TIME_END, amount: 1 });

    expect(single.body.isAvailable).to.equal(true);
    expect(batch.isAvailable).to.equal(single.body.isAvailable);
    expect(v1.status).to.equal(200);
    expect(priceFields(v1.body)).to.deep.equal(price);
    expect(v2.body.data).to.deep.equal(price);
    expect(batch.price).to.deep.equal(price);
  });

  it("reads the bookables of a request with one query", async function () {
    h = await installHarness({ bookablesFromModel: true });

    const res = await post({
      bookableIds: ["room", "auto-room", "free-room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.status).to.equal(200);
    expect(res.body.map((o) => o.bookableId).sort()).to.deep.equal([
      "auto-room",
      "free-room",
      "room",
    ]);
    expect(BookableModel.find.callCount).to.equal(1);
  });

  it("answers a bookable whose checkout throws as an error and the others as usual", async function () {
    h = await installHarness();
    const init = ItemCheckoutService.prototype.init;
    sinon
      .stub(ItemCheckoutService.prototype, "init")
      .callsFake(async function (bookable) {
        if (this.bookableId === "auto-room") {
          throw new Error("Tenant tenant-1 has no active app");
        }
        return init.call(this, bookable);
      });

    const res = await post({
      bookableIds: ["room", "auto-room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    });

    expect(res.status).to.equal(200);
    expect(res.body.find((o) => o.bookableId === "auto-room")).to.deep.equal({
      bookableId: "auto-room",
      title: "Raum (sofort)",
      isAvailable: false,
      totalCapacity: null,
      booked: null,
      remaining: null,
      reason: "error",
      price: null,
    });
    const room = res.body.find((o) => o.bookableId === "room");
    expect(room).to.include({ title: "Raum", isAvailable: true });
    expect(room).to.not.have.property("reason");
    expect(room.price).to.include({
      regularPriceEur: 40,
      userGrossPriceEur: 40,
    });
  });

  describe("an offer the public does not reach", function () {
    // A supervised tenant lets out an offer with an approved review only.
    const install = () =>
      installHarness({
        bookablesFromModel: true,
        tenant: { supervisionLevel: "supervised" },
        bookables: {
          room: bookable({
            id: "room",
            title: "Raum",
            review: { status: "approved" },
          }),
          "auto-room": bookable({
            id: "auto-room",
            title: "Raum (sofort)",
            autoCommitBooking: true,
            review: { status: "pending" },
          }),
        },
      });
    const body = {
      bookableIds: ["room", "auto-room"],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
    };

    it("is left out for an anonymous caller", async function () {
      h = await install();

      const res = await post(body);

      expect(res.status).to.equal(200);
      expect(res.body.map((o) => o.bookableId)).to.deep.equal(["room"]);
      expect(JSON.stringify(res.body)).to.not.include("auto-room");
    });

    it("is answered for the staff, who reach every bookable", async function () {
      h = await install();

      const res = await h.api().post(OCCUPANCY).set(h.as(ADMIN)).send(body);

      expect(res.status).to.equal(200);
      expect(res.body.map((o) => o.bookableId).sort()).to.deep.equal([
        "auto-room",
        "room",
      ]);
    });
  });
});
