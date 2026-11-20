/**
 * `BookableService.getPeriodOccupancies` checks the bookables of one request
 * five at a time in a pool: a slow bookable (an external provider) holds one
 * slot, the others go on, and the answer keeps the order of the bookables.
 * The checks of one request share one cache of the external providers.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookableService = require("../src/commons/services/bookable-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("period occupancies in a pool", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("keeps five in flight past a slow bookable and the order of the bookables", async function () {
    const ids = ["slow", "b", "c", "d", "e", "f", "g", "h"];
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .resolves(ids.map((id) => ({ id, title: id })));

    // "slow" finishes only once the others are done, or after a second -
    // the way out for fixed rounds, which would wait for it first.
    let running = 0;
    let peak = 0;
    let slowDone = false;
    let othersDone = 0;
    let releaseSlow;
    let fallback;
    const slowReleased = new Promise((resolve) => {
      releaseSlow = resolve;
      fallback = setTimeout(resolve, 1000);
    });
    const startedWhileSlow = [];
    sinon
      .stub(BookableService, "_getPeriodOccupancy")
      .callsFake(async ({ bookable }) => {
        running++;
        peak = Math.max(peak, running);
        if (!slowDone) startedWhileSlow.push(bookable.id);
        if (bookable.id === "slow") {
          await slowReleased;
          slowDone = true;
        } else {
          await wait(1);
          if (++othersDone === ids.length - 1) releaseSlow();
        }
        running--;
        return { bookableId: bookable.id };
      });

    const results = await BookableService.getPeriodOccupancies({
      bookableIds: ids,
      tenantId: "t",
      timeBegin: 1,
      timeEnd: 2,
    });
    clearTimeout(fallback);

    expect(results.map((r) => r.bookableId)).to.deep.equal(ids);
    expect(peak).to.equal(5);
    // In fixed rounds of five, "f" to "h" would wait for "slow".
    expect(startedWhileSlow).to.deep.equal(ids);
  });

  it("shares one cache of the external providers within a request, not across requests", async function () {
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .resolves(["a", "b", "c"].map((id) => ({ id, title: id })));
    sinon.stub(ItemCheckoutService.prototype, "init").resolves();
    const caches = [];
    sinon
      .stub(ItemCheckoutService.prototype, "checkAll")
      .callsFake(async function () {
        caches.push(this.externalCache);
        return [];
      });

    const ask = () =>
      BookableService.getPeriodOccupancies({
        bookableIds: ["a", "b", "c"],
        tenantId: "t",
        timeBegin: 1,
        timeEnd: 2,
      });
    await ask();
    await ask();

    expect(caches).to.have.length(6);
    expect(caches[0]).to.be.instanceOf(Map);
    expect(new Set(caches.slice(0, 3)).size).to.equal(1);
    expect(new Set(caches.slice(3)).size).to.equal(1);
    expect(caches[3]).to.not.equal(caches[0]);
  });

  it("answers an empty list for no bookables", async function () {
    sinon.stub(BookableManager, "getBookablesByIds").resolves([]);

    expect(
      await BookableService.getPeriodOccupancies({
        bookableIds: ["x"],
        tenantId: "t",
        timeBegin: 1,
        timeEnd: 2,
      }),
    ).to.deep.equal([]);
  });
});
