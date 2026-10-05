const assert = require("assert");
const sinon = require("sinon");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const CouponService = require("../src/commons/services/coupon-service");
const PaymentUtils = require("../src/commons/utilities/payment-utils");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const {
  normalizeCheckError,
} = require("../src/commons/services/checkout/normalize-check-error");
const {
  CHECK_TYPES,
} = require("../src/commons/availability/checkout-check-types");

const TENANT_ID = "tenant-1";
const CUSTOMER_ID = "kunde@example.com";
const TIME_BEGIN = Date.UTC(2027, 5, 20, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 20, 11, 0, 0);

function plainBookable(overrides = {}) {
  return new Bookable({
    tenantId: TENANT_ID,
    priceType: "per-item",
    isBookable: true,
    isScheduleRelated: true,
    amount: 10,
    permittedUsers: [],
    permittedRoles: [],
    priceValueAddedTax: 0,
    preparationLeadTimeMinutes: null,
    serviceHours: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    priceCategories: [{ priceEur: 10, interval: { start: null, end: null } }],
    ...overrides,
  });
}

function isPerBookingRefusal(maxAmountPerBooking, bookableId) {
  return (err) => {
    const normalized = normalizeCheckError(err);
    assert.strictEqual(
      normalized.reason,
      CHECKOUT_REASONS.MAX_AMOUNT_PER_BOOKING_EXCEEDED,
    );
    assert.strictEqual(normalized.checkType, CHECK_TYPES.MAX_AMOUNT);
    assert.strictEqual(
      normalized.params.maxAmountPerBooking,
      maxAmountPerBooking,
    );
    assert.strictEqual(normalized.params.bookableId, bookableId);
    return true;
  };
}

describe("Bookable maxAmountPerBooking", function () {
  const valid = (overrides) =>
    plainBookable({
      id: "room-a",
      title: "Room A",
      type: "room",
      ...overrides,
    });

  it("accepts an empty value and a positive integer", function () {
    for (const value of [null, "", 1, 3]) {
      assert.ok(valid({ maxAmountPerBooking: value }).validate());
    }
  });

  it("rejects zero, negatives and fractions", function () {
    for (const value of [0, -1, 2.5]) {
      assert.throws(
        () => valid({ maxAmountPerBooking: value }).validate(),
        (err) =>
          err.errors.some((e) => e.field === "maxAmountPerBooking") &&
          err.errors.every((e) => e.field === "maxAmountPerBooking"),
        `expected ${value} to be rejected`,
      );
    }
  });

  it("is part of the public projection", function () {
    const bookable = plainBookable({ id: "room-a", maxAmountPerBooking: 4 });
    assert.strictEqual(bookable.exportPublic().maxAmountPerBooking, 4);
  });
});

describe("ItemCheckoutService.checkMaxAmount — maximum per booking", function () {
  afterEach(function () {
    sinon.restore();
  });

  function itemService(bookable, { amount, amountInBooking } = {}) {
    const service = new ItemCheckoutService({
      user: CUSTOMER_ID,
      tenantId: TENANT_ID,
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      bookableId: bookable.id,
      amount,
      amountInBooking,
    });
    service.originBookable = bookable;
    service.externalProviders = [];
    return service;
  }

  it("passes up to the maximum and refuses one unit more", async function () {
    const bookable = plainBookable({ id: "room-a", maxAmountPerBooking: 3 });

    await itemService(bookable, { amount: 3 }).checkMaxAmount();
    await assert.rejects(
      itemService(bookable, { amount: 4 }).checkMaxAmount(),
      isPerBookingRefusal(3, "room-a"),
    );
  });

  it("names the unit of a bookable priced per square meter", async function () {
    const bookable = plainBookable({
      id: "hall",
      title: "Halle",
      priceType: "per-square-meter",
      maxAmountPerBooking: 20,
    });

    await assert.rejects(
      itemService(bookable, { amount: 21 }).checkMaxAmount(),
      (err) => {
        assert.strictEqual(
          err.message,
          "Von Halle können höchstens 20 m² je Buchung gebucht werden.",
        );
        return true;
      },
    );
  });

  it("counts what the whole booking holds, not the single position", async function () {
    const bookable = plainBookable({ id: "room-a", maxAmountPerBooking: 3 });

    await assert.rejects(
      itemService(bookable, { amount: 2, amountInBooking: 4 }).checkMaxAmount(),
      isPerBookingRefusal(3, "room-a"),
    );
    await itemService(bookable, {
      amount: 5,
      amountInBooking: 0,
    }).checkMaxAmount();
  });

  it("is unlimited without a maximum", async function () {
    const bookable = plainBookable({ id: "room-a", maxAmountPerBooking: null });
    await itemService(bookable, { amount: 99 }).checkMaxAmount();
  });

  it("applies besides an external provider's maximum", async function () {
    const bookable = plainBookable({
      id: "box",
      maxAmountPerBooking: 1,
      externalProviders: [
        { type: "ifbs", active: true, handles: ["maxAmount"] },
      ],
    });
    const provider = {
      handlesMaxAmount: true,
      checkMaxAmount: sinon.stub().resolves({ available: true }),
    };

    const allowed = itemService(bookable, { amount: 1 });
    allowed.externalProviders = [provider];
    await allowed.checkMaxAmount();
    sinon.assert.calledOnce(provider.checkMaxAmount);

    const refused = itemService(bookable, { amount: 2 });
    refused.externalProviders = [provider];
    await assert.rejects(
      refused.checkMaxAmount(),
      isPerBookingRefusal(1, "box"),
    );
  });
});

describe("BookingCheckout.createBooking — maximum per booking", function () {
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
    sinon.stub(TenantManager, "getTenant").resolves({ id: TENANT_ID });
    sinon.stub(EventManager, "getEvent").resolves(null);
    sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);
    sinon.stub(AccessService, "holdForBooking").resolves([]);
    sinon.stub(AccessService, "provisionForBooking").resolves([]);
    sinon.stub(CouponService, "incrementCouponUsage").resolves();
    sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
    sinon.stub(PaymentUtils, "checkInvoicePermission").resolves(true);
    return storeBooking;
  }

  function book(bookableItems, policy) {
    return BookingCheckout.createBooking({
      tenantId: TENANT_ID,
      user: { id: CUSTOMER_ID },
      simulate: false,
      policy,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems,
        name: "Kunde",
        mail: CUSTOMER_ID,
        isCommitted: false,
        isPayed: false,
        isRejected: false,
        paymentProvider: "invoice",
      },
    });
  }

  it("refuses a self-booking whose positions of one bookable add up past the maximum", async function () {
    const room = plainBookable({
      id: "room-a",
      title: "Room A",
      maxAmountPerBooking: 3,
    });
    const storeBooking = stubManagers({ [room.id]: room });

    await assert.rejects(
      book([
        { bookableId: room.id, amount: 2 },
        { bookableId: room.id, amount: 2 },
      ]),
      isPerBookingRefusal(3, room.id),
    );
    sinon.assert.notCalled(storeBooking);
  });

  it("books a self-booking at the maximum", async function () {
    const room = plainBookable({ id: "room-a", maxAmountPerBooking: 3 });
    const storeBooking = stubManagers({ [room.id]: room });

    await book([{ bookableId: room.id, amount: 3 }]);

    sinon.assert.calledOnce(storeBooking);
  });

  it("does not count a mandatory addon against its maximum", async function () {
    const addon = plainBookable({ id: "addon-a", maxAmountPerBooking: 1 });
    const room = plainBookable({
      id: "room-a",
      checkoutBookableIds: [{ bookableId: addon.id, mandatory: true }],
    });
    const storeBooking = stubManagers({
      [room.id]: room,
      [addon.id]: addon,
    });

    await book([{ bookableId: room.id, amount: 3 }]);

    const stored = storeBooking.firstCall.args[0];
    const addonItem = stored.bookableItems.find(
      (item) => item.bookableId === addon.id,
    );
    assert.strictEqual(addonItem.amount, 3);
  });

  it("counts an optional addon against its maximum", async function () {
    const addon = plainBookable({ id: "addon-a", maxAmountPerBooking: 1 });
    const room = plainBookable({
      id: "room-a",
      checkoutBookableIds: [{ bookableId: addon.id, mandatory: false }],
    });
    stubManagers({ [room.id]: room, [addon.id]: addon });

    await assert.rejects(
      book([
        { bookableId: room.id, amount: 1 },
        { bookableId: addon.id, amount: 2 },
      ]),
      isPerBookingRefusal(1, addon.id),
    );
  });

  it("leaves a manual booking unlimited", async function () {
    const room = plainBookable({ id: "room-a", maxAmountPerBooking: 3 });
    const storeBooking = stubManagers({ [room.id]: room });

    await book(
      [{ bookableId: room.id, amount: 5 }],
      CheckoutPolicy.ADMIN_MANUAL,
    );

    sinon.assert.calledOnce(storeBooking);
  });
});
