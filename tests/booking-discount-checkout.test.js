const assert = require("assert");
const sinon = require("sinon");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  ManualItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const CouponService = require("../src/commons/services/coupon-service");

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";

function discountBookable(overrides = {}) {
  return new Bookable({
    id: "room-a",
    tenantId: TENANT_ID,
    title: "Room A",
    priceType: "per-item",
    priceCategories: [{ priceEur: 100, interval: { start: null, end: null } }],
    bookingDiscounts: {
      users: [],
      roles: [],
    },
    ...overrides,
  });
}

async function createCheckoutService(bookable, options = {}) {
  const service = new ManualItemCheckoutService({
    user: USER_ID,
    tenantId: TENANT_ID,
    timeBegin: Date.now(),
    timeEnd: Date.now() + 3600000,
    bookableId: bookable.id,
    amount: 1,
    couponCode: options.couponCode ?? null,
    bookWithoutDiscount: options.bookWithoutDiscount ?? false,
  });

  await service.init(bookable);
  return service;
}

describe("Bookable booking discounts", function () {
  it("returns the highest discount when user and role both match", function () {
    const bookable = discountBookable({
      bookingDiscounts: {
        users: [{ userId: USER_ID, discountPercent: 30 }],
        roles: [{ roleId: "role-member", discountPercent: 50 }],
      },
    });

    assert.strictEqual(
      bookable.getUserDiscountPercent(USER_ID, ["role-member"]),
      50,
    );
  });

  it("returns 0 when no discount is configured", function () {
    const bookable = discountBookable();

    assert.strictEqual(
      bookable.getUserDiscountPercent(USER_ID, ["role-member"]),
      0,
    );
  });
});

describe("ItemCheckoutService booking discount pricing", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("applies a role-based percentage discount before coupons", async function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: ["role-member"] });
    sinon
      .stub(CouponService, "applyCoupon")
      .callsFake(async (_code, _tenant, price) => {
        return Math.max(0, price - 10);
      });

    const bookable = discountBookable({
      enableCoupons: true,
      bookingDiscounts: {
        users: [],
        roles: [{ roleId: "role-member", discountPercent: 50 }],
      },
    });

    const service = await createCheckoutService(bookable, {
      couponCode: "SAVE10",
    });

    assert.strictEqual(await service.bookingDiscountPercent(), 50);
    assert.strictEqual(await service.freeBookingAllowed(), false);
    assert.strictEqual(await service.userPriceEur(), 40);
  });

  it("treats 100 percent discount as free booking", async function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: [] });
    sinon
      .stub(CouponService, "applyCoupon")
      .callsFake(async (_code, _tenant, price) => price);

    const bookable = discountBookable({
      bookingDiscounts: {
        users: [{ userId: USER_ID, discountPercent: 100 }],
        roles: [],
      },
    });

    const service = await createCheckoutService(bookable);

    assert.strictEqual(await service.bookingDiscountPercent(), 100);
    assert.strictEqual(await service.freeBookingAllowed(), true);
    assert.strictEqual(await service.userPriceEur(), 0);
  });

  it("ignores discounts when bookWithoutDiscount is true", async function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: [] });
    sinon
      .stub(CouponService, "applyCoupon")
      .callsFake(async (_code, _tenant, price) => price);

    const bookable = discountBookable({
      bookingDiscounts: {
        users: [{ userId: USER_ID, discountPercent: 100 }],
        roles: [],
      },
    });

    const service = await createCheckoutService(bookable, {
      bookWithoutDiscount: true,
    });

    assert.strictEqual(await service.bookingDiscountPercent(), 100);
    assert.strictEqual(await service.freeBookingAllowed(), true);
    assert.strictEqual(await service.userPriceEur(), 100);
  });
});
