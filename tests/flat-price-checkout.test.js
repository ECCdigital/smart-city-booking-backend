const assert = require("assert");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

// The checkout splits a booking at local midnight, so the times are built in
// local time: each booking below crosses midnight in any time zone.
// 2026-09-04 is a Friday, 2026-09-05 a Saturday, 2026-09-07 a Monday.
function at(day, hours) {
  return new Date(2026, 8, day, hours, 0, 0, 0).getTime();
}

function bookable(priceType, priceCategories) {
  return new Bookable({
    id: "room-a",
    tenantId: "tenant-1",
    title: "Test Raum",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 1,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType,
    priceValueAddedTax: 0,
    priceCategories,
  });
}

function category(overrides) {
  return {
    priceEur: 0,
    interval: { start: "", end: "" },
    fixedPrice: false,
    holidays: [],
    weekdays: [],
    ...overrides,
  };
}

async function regularPrice(item, timeBegin, timeEnd) {
  const service = new ItemCheckoutService(
    {
      user: null,
      tenantId: "tenant-1",
      timeBegin,
      timeEnd,
      bookableId: "room-a",
      amount: 1,
      couponCode: null,
    },
    CheckoutPolicy.ADMIN_MANUAL,
  );
  await service.init(item);
  return service.regularPriceEur();
}

describe("flat-rate price categories (smart-city-booking-issues#37)", function () {
  const flatFourToTwentyFourHours = () =>
    bookable("per-hour", [
      category({
        priceEur: 50,
        interval: { start: 4, end: 24 },
        fixedPrice: true,
      }),
      category({ priceEur: 5, interval: { start: 0, end: 4 } }),
    ]);

  it("charges the flat rate once for a booking within one day", async function () {
    assert.strictEqual(
      await regularPrice(flatFourToTwentyFourHours(), at(4, 8), at(4, 20)),
      50,
    );
  });

  it("charges the flat rate once for a booking over midnight", async function () {
    assert.strictEqual(
      await regularPrice(flatFourToTwentyFourHours(), at(4, 20), at(5, 8)),
      50,
    );
  });

  it("charges a per-day flat rate once for a booking over several days", async function () {
    const item = bookable("per-day", [
      category({
        priceEur: 90,
        interval: { start: 1, end: 3 },
        fixedPrice: true,
      }),
    ]);

    // Mon 10:00 to Thu 10:00: four daily segments, one booking.
    assert.strictEqual(await regularPrice(item, at(7, 10), at(10, 10)), 90);
  });

  it("still prices a time-based category per segment over midnight", async function () {
    const item = bookable("per-hour", [category({ priceEur: 5 })]);

    assert.strictEqual(await regularPrice(item, at(4, 20), at(5, 8)), 60);
  });

  describe("with a flat weekday category and an hourly weekend category", function () {
    const weekdayFlatWeekendHourly = () =>
      bookable("per-hour", [
        category({
          priceEur: 50,
          interval: { start: 4, end: 24 },
          fixedPrice: true,
          weekdays: [1, 2, 3, 4, 5],
        }),
        category({ priceEur: 5, weekdays: [6, 0] }),
      ]);

    it("charges the flat rate once over midnight between two weekdays", async function () {
      // Mon 20:00 to Tue 08:00
      assert.strictEqual(
        await regularPrice(weekdayFlatWeekendHourly(), at(7, 20), at(8, 8)),
        50,
      );
    });

    it("adds the hourly weekend part to the flat weekday part", async function () {
      // Fri 20:00 to Sat 08:00: Friday at the flat rate, Saturday 8 h hourly.
      assert.strictEqual(
        await regularPrice(weekdayFlatWeekendHourly(), at(4, 20), at(5, 8)),
        90,
      );
    });
  });
});
