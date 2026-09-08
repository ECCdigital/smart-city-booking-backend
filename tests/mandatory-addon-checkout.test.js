const assert = require("assert");
const sinon = require("sinon");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const CouponService = require("../src/commons/services/coupon-service");
const PaymentUtils = require("../src/commons/utilities/payment-utils");
const {
  resolveCheckoutItems,
} = require("../src/commons/utilities/checkout-utils");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");

const TENANT_ID = "tenant-1";
const CUSTOMER_ID = "kunde@example.com";
const PARENT_PRICE = 100;
const ADDON_PRICE = 10;
const TIME_BEGIN = Date.UTC(2027, 5, 20, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 20, 11, 0, 0);

function plainBookable(overrides = {}) {
  return new Bookable({
    tenantId: TENANT_ID,
    priceType: "per-item",
    isBookable: true,
    isScheduleRelated: true,
    amount: 5,
    permittedUsers: [],
    permittedRoles: [],
    priceValueAddedTax: 0,
    preparationLeadTimeMinutes: null,
    serviceHours: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    ...overrides,
  });
}

describe("BookingCheckout.createBooking — mandatory addons are never priced twice", function () {
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

  function stubManagers(bookablesById) {
    sinon.stub(BookingManager, "getBooking").resolves(null);
    const storeBooking = sinon
      .stub(BookingManager, "storeBooking")
      .callsFake(async (value) => value);
    sinon.stub(BookingManager, "getConcurrentBookings").resolves([]);
    sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
    sinon.stub(BookingManager, "getEventBookings").resolves([]);
    sinon
      .stub(BookableManager, "getBookable")
      .callsFake(async (id) => bookablesById[id]);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: CUSTOMER_ID, roles: [] });
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
    sinon.stub(PaymentUtils, "checkInvoicePermission").resolves(true);
    return storeBooking;
  }

  it("corrects a mismatched addon amount without duplicating the item", async function () {
    const addon = plainBookable({
      id: "addon-a",
      title: "Addon A",
      priceCategories: [
        { priceEur: ADDON_PRICE, interval: { start: null, end: null } },
      ],
    });
    const parent = plainBookable({
      id: "room-a",
      title: "Room A",
      priceCategories: [
        { priceEur: PARENT_PRICE, interval: { start: null, end: null } },
      ],
      checkoutBookableIds: [{ bookableId: addon.id, mandatory: true }],
    });
    const storeBooking = stubManagers({
      [parent.id]: parent,
      [addon.id]: addon,
    });

    // The cart already contains the mandatory addon, but with an amount that
    // does not match the parent's — the case that used to be priced twice.
    const cartItems = [
      { bookableId: parent.id, amount: 2 },
      { bookableId: addon.id, amount: 1 },
    ];

    await BookingCheckout.createBooking({
      tenantId: TENANT_ID,
      user: { id: CUSTOMER_ID },
      simulate: false,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: cartItems,
        name: "Kunde",
        mail: CUSTOMER_ID,
        isCommitted: false,
        isPayed: false,
        isRejected: false,
        paymentProvider: "invoice",
      },
    });

    const stored = storeBooking.firstCall.args[0];
    const storedAddonItems = stored.bookableItems.filter(
      (item) => item.bookableId === addon.id,
    );

    assert.strictEqual(stored.bookableItems.length, 2);
    assert.strictEqual(storedAddonItems.length, 1);
    assert.strictEqual(storedAddonItems[0].amount, 2);
    assert.strictEqual(stored.priceEur, 2 * PARENT_PRICE + 2 * ADDON_PRICE);
  });

  it("appends a missing mandatory addon with the parent's amount", async function () {
    const addon = plainBookable({
      id: "addon-a",
      title: "Addon A",
      priceCategories: [
        { priceEur: ADDON_PRICE, interval: { start: null, end: null } },
      ],
    });
    const parent = plainBookable({
      id: "room-a",
      title: "Room A",
      priceCategories: [
        { priceEur: PARENT_PRICE, interval: { start: null, end: null } },
      ],
      checkoutBookableIds: [{ bookableId: addon.id, mandatory: true }],
    });
    const storeBooking = stubManagers({
      [parent.id]: parent,
      [addon.id]: addon,
    });

    await BookingCheckout.createBooking({
      tenantId: TENANT_ID,
      user: { id: CUSTOMER_ID },
      simulate: false,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: [{ bookableId: parent.id, amount: 3 }],
        name: "Kunde",
        mail: CUSTOMER_ID,
        isCommitted: false,
        isPayed: false,
        isRejected: false,
        paymentProvider: "invoice",
      },
    });

    const stored = storeBooking.firstCall.args[0];
    const storedAddonItems = stored.bookableItems.filter(
      (item) => item.bookableId === addon.id,
    );

    assert.strictEqual(storedAddonItems.length, 1);
    assert.strictEqual(storedAddonItems[0].amount, 3);
    assert.strictEqual(stored.priceEur, 3 * PARENT_PRICE + 3 * ADDON_PRICE);
  });

  it("resolves the same items on the checkout path as resolveCheckoutItems on the validate path", async function () {
    const addon = plainBookable({
      id: "addon-a",
      title: "Addon A",
      priceCategories: [
        { priceEur: ADDON_PRICE, interval: { start: null, end: null } },
      ],
    });
    const parent = plainBookable({
      id: "room-a",
      title: "Room A",
      priceCategories: [
        { priceEur: PARENT_PRICE, interval: { start: null, end: null } },
      ],
      checkoutBookableIds: [{ bookableId: addon.id, mandatory: true }],
    });
    const storeBooking = stubManagers({
      [parent.id]: parent,
      [addon.id]: addon,
    });

    const cart = () => [
      { bookableId: parent.id, amount: 2 },
      { bookableId: addon.id, amount: 1 },
    ];

    const validatedItems = await resolveCheckoutItems(cart(), TENANT_ID);

    await BookingCheckout.createBooking({
      tenantId: TENANT_ID,
      user: { id: CUSTOMER_ID },
      simulate: false,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: cart(),
        name: "Kunde",
        mail: CUSTOMER_ID,
        isCommitted: false,
        isPayed: false,
        isRejected: false,
        paymentProvider: "invoice",
      },
    });

    const stored = storeBooking.firstCall.args[0];
    const byId = (items) =>
      items
        .map((item) => ({ bookableId: item.bookableId, amount: item.amount }))
        .sort((a, b) => a.bookableId.localeCompare(b.bookableId));

    assert.deepStrictEqual(byId(stored.bookableItems), byId(validatedItems));

    // The validate-group path prices the resolved items through
    // validateAndGetPrices; its totals must equal what checkout stored.
    const validateService = new BundleCheckoutService({
      user: CUSTOMER_ID,
      tenant: TENANT_ID,
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      bookableItems: validatedItems.map((item) => ({ ...item })),
      couponCode: null,
      bookWithoutDiscount: false,
    });
    const prices = await validateService.validateAndGetPrices();

    assert.strictEqual(prices.userGrossPriceEur, stored.priceEur);
    assert.strictEqual(
      prices.userPriceEur,
      stored.priceEur - stored.vatIncludedEur,
    );
  });
});
