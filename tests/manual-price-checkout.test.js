const assert = require("assert");
const sinon = require("sinon");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { Booking } = require("../src/commons/entities/booking/booking");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const AccessService = require("../src/commons/services/access/access-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");

const TENANT_ID = "tenant-1";
// Tue 2026-09-01 16:28–18:28 CEST: a 2 h slot on a weekday.
const TIME_BEGIN = 1788272933117;
const TIME_END = 1788280133117;

function perDayBookable(overrides = {}) {
  return new Bookable({
    id: "room-a",
    tenantId: TENANT_ID,
    title: "Test Tag",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 219,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-day",
    priceValueAddedTax: 0,
    enableCoupons: true,
    cancellationPolicy: { userCancellable: true },
    priceCategories: [
      {
        priceEur: 60,
        interval: { start: "", end: "" },
        fixedPrice: false,
        holidays: [],
        weekdays: [1, 2, 3, 4, 5],
      },
      {
        priceEur: 10,
        interval: { start: "", end: "1" },
        fixedPrice: true,
        holidays: [],
        weekdays: [6, 0],
      },
    ],
    ...overrides,
  });
}

function itemService(policy, extra = {}) {
  return new ItemCheckoutService(
    {
      user: "admin@stadt.de",
      tenantId: TENANT_ID,
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      bookableId: "room-a",
      amount: 1,
      couponCode: null,
      ...extra,
    },
    policy,
  );
}

describe("manualPriceEur on a bookable item", function () {
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

  it("prices from the categories when no manual price is given (2 h of a 60 €/day weekday = 5 €)", async function () {
    const service = itemService(CheckoutPolicy.ADMIN_MANUAL);
    await service.init(perDayBookable());

    assert.strictEqual(await service.regularPriceEur(), 5);
    assert.strictEqual(await service.userPriceEur(), 5);
  });

  it("replaces the category price under ADMIN_MANUAL, VAT still applies", async function () {
    const service = itemService(CheckoutPolicy.ADMIN_MANUAL, {
      manualPriceEur: 42,
    });
    await service.init(perDayBookable({ priceValueAddedTax: 19 }));

    assert.strictEqual(await service.regularPriceEur(), 42);
    assert.strictEqual(await service.regularGrossPriceEur(), 49.98);
    assert.strictEqual(await service.userPriceEur(), 42);
    assert.strictEqual(await service.userGrossPriceEur(), 49.98);
  });

  it("treats null as 'no manual price'", async function () {
    const service = itemService(CheckoutPolicy.ADMIN_MANUAL, {
      manualPriceEur: null,
    });
    await service.init(perDayBookable());

    assert.strictEqual(await service.regularPriceEur(), 5);
  });

  it("ignores a manual price under SELF_SERVICE", async function () {
    const service = itemService(CheckoutPolicy.SELF_SERVICE, {
      manualPriceEur: 42,
    });
    await service.init(perDayBookable());

    assert.strictEqual(service.manualPriceEur, null);
    assert.strictEqual(await service.regularPriceEur(), 5);
  });

  it("rejects a manual price that is not a non-negative number", function () {
    for (const bad of ["abc", -1, Infinity, {}]) {
      assert.throws(
        () => itemService(CheckoutPolicy.ADMIN_MANUAL, { manualPriceEur: bad }),
        /invalid_manual_price/,
      );
    }
  });

  it("accepts 0 as an explicit free price", async function () {
    const service = itemService(CheckoutPolicy.ADMIN_MANUAL, {
      manualPriceEur: 0,
    });
    await service.init(perDayBookable());

    assert.strictEqual(await service.regularPriceEur(), 0);
  });
});

describe("a manual price never reaches a self-service booking", function () {
  beforeEach(function () {
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "kunde@example.com", roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(BookableManager, "getBookable").resolves(perDayBookable());
    sinon
      .stub(BundleCheckoutService.prototype, "generateBookingReference")
      .resolves("TEST-REF");
    // Availability checks are covered by their own tests; here only the
    // pricing and the shape of the prepared booking matter.
    sinon.stub(ItemCheckoutService.prototype, "checkAll").resolves(true);
  });

  afterEach(function () {
    sinon.restore();
  });

  function bundle(policy, adminOverrides, items) {
    return new BundleCheckoutService(
      {
        user: "kunde@example.com",
        tenant: TENANT_ID,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: items,
        email: "kunde@example.com",
      },
      policy,
      adminOverrides,
    );
  }

  const callerItems = () => [
    { bookableId: "room-a", amount: 1, manualPriceEur: 0 },
  ];

  it("prepares a SELF_SERVICE booking at the category price without the field, leaving the caller's items untouched", async function () {
    const items = callerItems();
    const service = bundle(CheckoutPolicy.SELF_SERVICE, undefined, items);

    const booking = await service.prepareBooking();

    assert.strictEqual(booking.priceEur, 5);
    assert.strictEqual("manualPriceEur" in booking.bookableItems[0], false);
    assert.strictEqual(items[0].manualPriceEur, 0);
  });

  it("prepares an ADMIN_MANUAL booking at the manual price and keeps the field", async function () {
    const service = bundle(
      CheckoutPolicy.ADMIN_MANUAL,
      { isCommitted: false, isPayed: false, isRejected: false },
      callerItems(),
    );

    const booking = await service.prepareBooking();

    assert.strictEqual(booking.priceEur, 0);
    assert.strictEqual(booking.bookableItems[0].manualPriceEur, 0);
  });
});

describe("BookingCheckout.updateBooking with a manual price", function () {
  let BookingCheckout;

  before(function () {
    BookingCheckout = require("../src/commons/services/checkout/booking-checkout");
  });

  afterEach(function () {
    sinon.restore();
  });

  it("stores the admin's price and keeps it on the item for later updates", async function () {
    const stored = perDayBookable();
    const oldBooking = new Booking({
      id: "XRXR-QEUJ",
      tenantId: TENANT_ID,
      assignedUserId: "kunde@example.com",
      mail: "kunde@example.com",
      bookableItems: [{ bookableId: stored.id, amount: 1, userPriceEur: 5 }],
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      priceEur: 5,
      paymentProvider: "invoice",
    });

    sinon.stub(BookingManager, "getBooking").resolves(oldBooking);
    sinon.stub(BookingManager, "storeBooking").callsFake(async (b) => b);
    const storeBooking = sinon
      .stub(BookingManager, "storeBookingIfStatus")
      .callsFake(async (b) => b);
    sinon.stub(BookableManager, "getBookable").resolves(stored);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "kunde@example.com", roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(UserManager, "getRawUser").resolves(null);
    sinon.stub(TenantManager, "getTenant").resolves(null);
    sinon.stub(AccessService, "holdForBooking").resolves();
    sinon.stub(AccessService, "revokeForBooking").resolves();
    sinon.stub(AccessService, "updateForBooking").resolves();
    sinon.stub(AccessService, "provisionForBooking").resolves();
    sinon.stub(WorkflowService, "updateTask").resolves();
    sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();

    const updated = new Booking({
      ...oldBooking,
      bookableItems: [
        {
          bookableId: stored.id,
          amount: 1,
          _bookableUsed: stored,
          userPriceEur: 5,
          manualPriceEur: 42,
        },
      ],
      isCommitted: false,
      isPayed: false,
      isRejected: false,
    });

    await BookingCheckout.updateBooking(TENANT_ID, updated, {
      requestBody: updated,
    });

    const result = storeBooking.firstCall.args[0];
    assert.strictEqual(result.priceEur, 42);
    assert.strictEqual(result.bookableItems[0].userPriceEur, 42);
    assert.strictEqual(result.bookableItems[0].manualPriceEur, 42);
  });
});
