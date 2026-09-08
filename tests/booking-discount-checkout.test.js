const assert = require("assert");
const sinon = require("sinon");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const CouponService = require("../src/commons/services/coupon-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");

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
  const service = new ItemCheckoutService({
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
      .stub(CouponService, "applyCouponToCheckoutPrices")
      .callsFake(async (_code, _tenant, netPrice, vatRate) => {
        const net = Math.max(0, netPrice - 10);
        return {
          netPrice: net,
          grossPrice: Math.round(net * (1 + vatRate) * 100) / 100,
        };
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
      .stub(CouponService, "applyCouponToCheckoutPrices")
      .callsFake(async (_code, _tenant, netPrice, vatRate) => ({
        netPrice,
        grossPrice: Math.round(netPrice * (1 + vatRate) * 100) / 100,
      }));

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
      .stub(CouponService, "applyCouponToCheckoutPrices")
      .callsFake(async (_code, _tenant, netPrice, vatRate) => ({
        netPrice,
        grossPrice: Math.round(netPrice * (1 + vatRate) * 100) / 100,
      }));

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

describe("BookingCheckout.createBooking — manual create ignores booking discounts", function () {
  const ADMIN_ID = "admin@stadt.de";
  const CUSTOMER_MAIL = "kunde@example.com";
  const LIST_PRICE = 100;
  const TIME_BEGIN = Date.UTC(2026, 5, 20, 10, 0, 0);
  const TIME_END = Date.UTC(2026, 5, 20, 11, 0, 0);

  let BookingCheckout;
  let BookingManager;
  let BookableManager;
  let TenantManager;
  let EventManager;
  let OpeningHoursManager;
  let AccessService;
  let WorkflowService;

  before(function () {
    BookingCheckout = require("../src/commons/services/checkout/booking-checkout");
    BookingManager = require("../src/commons/data-managers/booking-manager");
    ({
      BookableManager,
    } = require("../src/commons/data-managers/bookable-manager"));
    TenantManager = require("../src/commons/data-managers/tenant-manager");
    EventManager = require("../src/commons/data-managers/event-manager");
    OpeningHoursManager = require("../src/commons/utilities/opening-hours-manager");
    AccessService = require("../src/commons/services/access/access-service");
    WorkflowService = require("../src/commons/services/workflow/workflow-service");
  });

  afterEach(function () {
    sinon.restore();
  });

  it("does not apply the creating admin's booking discount on manual create", async function () {
    const bookable = discountBookable({
      isBookable: true,
      isScheduleRelated: true,
      amount: 5,
      permittedUsers: [],
      permittedRoles: [],
      priceValueAddedTax: 0,
      preparationLeadTimeMinutes: null,
      serviceHours: [],
      bookingDiscounts: {
        users: [{ userId: ADMIN_ID, discountPercent: 100 }],
        roles: [],
      },
    });

    sinon.stub(BookingManager, "getBooking").resolves(null);
    const storeBooking = sinon
      .stub(BookingManager, "storeBooking")
      .callsFake(async (value) => value);
    sinon.stub(BookingManager, "getConcurrentBookings").resolves([]);
    sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
    sinon.stub(BookingManager, "getEventBookings").resolves([]);
    sinon.stub(BookableManager, "getBookable").resolves(bookable);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: ADMIN_ID, roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(TenantManager, "getTenant").resolves(null);
    sinon.stub(EventManager, "getEvent").resolves(null);
    sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);
    sinon.stub(AccessService, "holdForBooking").resolves([]);
    sinon.stub(AccessService, "provisionForBooking").resolves([]);
    sinon.stub(CouponService, "incrementCouponUsage").resolves();
    sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();

    await BookingCheckout.createBooking({
      tenantId: TENANT_ID,
      user: { id: ADMIN_ID },
      simulate: false,
      policy: CheckoutPolicy.ADMIN_MANUAL,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: [
          { bookableId: bookable.id, amount: 1, _bookableUsed: bookable },
        ],
        name: "Kunde",
        mail: CUSTOMER_MAIL,
        paymentProvider: "invoice",
        isCommitted: false,
        isPayed: false,
        isRejected: false,
      },
    });

    const stored = storeBooking.firstCall.args[0];
    assert.strictEqual(stored.bookableItems[0].regularPriceEur, LIST_PRICE);
    assert.strictEqual(stored.bookableItems[0].userPriceEur, LIST_PRICE);
    assert.strictEqual(stored.priceEur, LIST_PRICE);
  });
});
