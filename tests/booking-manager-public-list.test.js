const assert = require("assert");
const sinon = require("sinon");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  PUBLIC,
  DOMAIN,
} = require("../src/commons/services/authorization/reach");

describe("BookingManager.getTenantBookings as the public", function () {
  afterEach(function () {
    sinon.restore();
  });

  const listedOnly = { id: "b1", bookableIds: ["room-public"] };
  const withUnlisted = {
    id: "b2",
    bookableIds: ["room-public", "room-hidden"],
  };
  const withoutBookables = { id: "b3", bookableIds: [] };

  function bookingsInStore() {
    sinon.stub(BookingModel, "find").resolves([]);
    sinon
      .stub(BookingManager, "_toEntities")
      .resolves([listedOnly, withUnlisted, withoutBookables]);
  }

  it("answers only the bookings of the bookables the public's list carries", async function () {
    bookingsInStore();
    const getBookables = sinon
      .stub(BookableManager, "getBookables")
      .resolves([{ id: "room-public" }]);

    const bookings = await BookingManager.getTenantBookings("t1", PUBLIC);

    assert.deepStrictEqual(
      bookings.map((b) => b.id),
      ["b1", "b3"],
    );
    assert.deepStrictEqual(getBookables.firstCall.args, ["t1", PUBLIC]);
  });

  it("answers every booking of the tenant to the domain", async function () {
    bookingsInStore();
    const getBookables = sinon.stub(BookableManager, "getBookables");

    const bookings = await BookingManager.getTenantBookings("t1", DOMAIN);

    assert.strictEqual(bookings.length, 3);
    assert.strictEqual(getBookables.called, false);
  });

  it("hands the public's 404 of a tenant without a projection on", async function () {
    bookingsInStore();
    const err = new Error("tenant_not_found");
    err.code = "tenant_not_found";
    sinon.stub(BookableManager, "getBookables").rejects(err);

    await assert.rejects(
      () => BookingManager.getTenantBookings("t1", PUBLIC),
      /tenant_not_found/,
    );
  });
});
