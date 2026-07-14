const assert = require("assert");
const sinon = require("sinon");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  ManualItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const CouponManager = require("../src/commons/data-managers/coupon-manager");
const CouponService = require("../src/commons/services/coupon-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { COUPON_TYPE } = require("../src/commons/entities/coupon/coupon");

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";

function couponBookable(overrides = {}) {
  return new Bookable({
    id: "ticket-a",
    tenantId: TENANT_ID,
    title: "Ticket A",
    priceType: "per-item",
    priceValueAddedTax: 19,
    priceCategories: [{ priceEur: 100, interval: { start: null, end: null } }],
    enableCoupons: true,
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

describe("CouponService.applyCouponToCheckoutPrices", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("deducts fixed-amount coupons from gross price", async function () {
    sinon.stub(CouponManager, "getCoupon").resolves({
      type: COUPON_TYPE.FIXED,
      discount: 10,
    });

    const result = await CouponService.applyCouponToCheckoutPrices(
      "SAVE10",
      TENANT_ID,
      100,
      0.19,
    );

    assert.strictEqual(result.grossPrice, 109);
    assert.strictEqual(result.netPrice, 91.6);
  });

  it("keeps percentage coupons on net price", async function () {
    sinon.stub(CouponManager, "getCoupon").resolves({
      type: COUPON_TYPE.PERCENTAGE,
      discount: 50,
    });

    const result = await CouponService.applyCouponToCheckoutPrices(
      "HALF",
      TENANT_ID,
      100,
      0.19,
    );

    assert.strictEqual(result.netPrice, 50);
    assert.strictEqual(result.grossPrice, 59.5);
  });

  it("returns unchanged prices when no coupon is provided", async function () {
    const result = await CouponService.applyCouponToCheckoutPrices(
      null,
      TENANT_ID,
      100,
      0.19,
    );

    assert.strictEqual(result.netPrice, 100);
    assert.strictEqual(result.grossPrice, 119);
  });
});

describe("ItemCheckoutService fixed coupon pricing", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("applies fixed-amount coupons to gross checkout price", async function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: [] });
    sinon.stub(CouponManager, "getCoupon").resolves({
      type: COUPON_TYPE.FIXED,
      discount: 10,
    });

    const service = await createCheckoutService(couponBookable(), {
      couponCode: "SAVE10",
    });

    assert.strictEqual(await service.userGrossPriceEur(), 109);
    assert.strictEqual(await service.userPriceEur(), 91.6);
  });
});
