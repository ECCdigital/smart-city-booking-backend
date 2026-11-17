const assert = require("assert");
const sinon = require("sinon");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const MembershipManager = require("../src/commons/data-managers/membership-manager");

const TENANT_ID = "tenant-1";

function category(priceEur, interval = {}, fixedPrice = false) {
  return {
    priceEur,
    interval: { start: null, end: null, ...interval },
    fixedPrice,
    holidays: [],
    weekdays: [],
  };
}

function perHourBookable(overrides = {}) {
  return new Bookable({
    id: "room-a",
    tenantId: TENANT_ID,
    title: "Raum",
    type: "room",
    isBookable: true,
    isScheduleRelated: true,
    amount: 1,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-hour",
    priceValueAddedTax: 0,
    enableCoupons: true,
    cancellationPolicy: { userCancellable: true },
    priceCategories: [category(10)],
    ...overrides,
  });
}

// Local times, as the price splits a booking at local midnight.
function at(day, hours, minutes = 0) {
  return new Date(2026, 8, day, hours, minutes).getTime();
}

async function priceOf(bookable, timeBegin, timeEnd) {
  const service = new ItemCheckoutService(
    {
      user: "admin@stadt.de",
      tenantId: TENANT_ID,
      timeBegin,
      timeEnd,
      bookableId: bookable.id,
      amount: 1,
      couponCode: null,
    },
    CheckoutPolicy.ADMIN_MANUAL,
  );
  await service.init(bookable);
  return service.regularPriceEur();
}

describe("hour price counting started hours", function () {
  beforeEach(function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "admin@stadt.de", roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("reckons by the minute when the option is off (2 h 10 min at 10 €/h)", async function () {
    const price = await priceOf(perHourBookable(), at(1, 10), at(1, 12, 10));
    assert.strictEqual(price, 21.67);
  });

  it("counts a started hour in full (2 h 10 min at 10 €/h = 3 h)", async function () {
    const price = await priceOf(
      perHourBookable({ priceCountStartedHours: true }),
      at(1, 10),
      at(1, 12, 10),
    );
    assert.strictEqual(price, 30);
  });

  it("leaves whole hours as they are", async function () {
    const price = await priceOf(
      perHourBookable({ priceCountStartedHours: true }),
      at(1, 10),
      at(1, 12),
    );
    assert.strictEqual(price, 20);
  });

  it("counts the started hour once across midnight (23:30 to 00:30)", async function () {
    const price = await priceOf(
      perHourBookable({ priceCountStartedHours: true }),
      at(1, 23, 30),
      at(2, 0, 30),
    );
    assert.strictEqual(price, 10);
  });

  it("picks the Tarif by the counted hours", async function () {
    const bookable = perHourBookable({
      priceCountStartedHours: true,
      priceCategories: [
        category(10, { start: 0, end: 2 }),
        category(8, { start: 3, end: null }),
      ],
    });
    const price = await priceOf(bookable, at(1, 10), at(1, 12, 10));
    assert.strictEqual(price, 24);
  });

  it("leaves a Tagespauschale untouched", async function () {
    const price = await priceOf(
      perHourBookable({
        priceCountStartedHours: true,
        priceCategories: [category(50, {}, true)],
      }),
      at(1, 10),
      at(1, 12, 10),
    );
    assert.strictEqual(price, 50);
  });

  it("does not touch a day price", async function () {
    const price = await priceOf(
      perHourBookable({
        priceType: "per-day",
        priceCountStartedHours: true,
        priceCategories: [category(24)],
      }),
      at(1, 10),
      at(1, 12, 30),
    );
    assert.strictEqual(price, 2.5);
  });
});
