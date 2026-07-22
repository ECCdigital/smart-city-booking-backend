const assert = require("assert");
const sinon = require("sinon");

const CheckoutControllerV2 = require("../src/platform/api/v2/controllers/checkout.controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  withMandatoryAddons,
} = require("../src/commons/utilities/checkout-utils");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");

const TENANT_ID = "tenant-1";

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    json: sandbox.stub().returnsThis(),
  };
}

function groupBookable(overrides = {}) {
  return {
    id: "room-a",
    tenantId: TENANT_ID,
    groupBooking: { enabled: true, permittedRoles: [] },
    checkoutBookableIds: [],
    ...overrides,
  };
}

describe("CheckoutControllerV2.validateGroup", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("rejects missing bookableItems", async function () {
    const res = response(sandbox);

    await CheckoutControllerV2.validateGroup(
      {
        params: { tenant: TENANT_ID },
        user: null,
        body: { bookingAttempts: [{ timeBegin: 1, timeEnd: 2 }] },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    const body = res.json.firstCall.args[0];
    assert.strictEqual(body.success, false);
    assert.strictEqual(
      body.error.reason,
      CHECKOUT_REASONS.INVALID_BOOKABLE_ITEMS,
    );
  });

  it("rejects when group booking is disabled", async function () {
    sandbox.stub(BookableManager, "getBookable").resolves(
      groupBookable({
        groupBooking: { enabled: false, permittedRoles: [] },
      }),
    );
    const res = response(sandbox);

    await CheckoutControllerV2.validateGroup(
      {
        params: { tenant: TENANT_ID },
        user: null,
        body: {
          bookableItems: [{ bookableId: "room-a", amount: 1 }],
          bookingAttempts: [{ timeBegin: 1, timeEnd: 2 }],
        },
      },
      res,
    );

    const body = res.json.firstCall.args[0];
    assert.strictEqual(body.success, false);
    assert.strictEqual(
      body.error.reason,
      CHECKOUT_REASONS.GROUP_BOOKING_DISABLED,
    );
  });

  it("returns per-attempt success and failure without failing the request", async function () {
    sandbox.stub(BookableManager, "getBookable").resolves(groupBookable());
    sandbox
      .stub(BundleCheckoutService.prototype, "validateAndGetPrices")
      .onFirstCall()
      .resolves({
        regularPriceEur: 100,
        userPriceEur: 100,
        regularGrossPriceEur: 119,
        userGrossPriceEur: 119,
        freeBookingAllowed: false,
        bookingDiscountPercent: 0,
      })
      .onSecondCall()
      .rejects({
        checkType: "availability",
        message: "nicht verfügbar",
      });

    const res = response(sandbox);

    await CheckoutControllerV2.validateGroup(
      {
        params: { tenant: TENANT_ID },
        user: null,
        body: {
          checkoutId: "01fixed",
          bookableItems: [{ bookableId: "room-a", amount: 1 }],
          bookingAttempts: [
            { timeBegin: 1000, timeEnd: 2000 },
            { timeBegin: 3000, timeEnd: 4000 },
          ],
        },
      },
      res,
    );

    const body = res.json.firstCall.args[0];
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.checkoutId, "01fixed");
    assert.strictEqual(body.data.allValid, false);
    assert.strictEqual(body.data.totals, null);
    assert.strictEqual(body.data.attempts.length, 2);
    assert.strictEqual(body.data.attempts[0].success, true);
    assert.strictEqual(body.data.attempts[0].data.userGrossPriceEur, 119);
    assert.strictEqual(body.data.attempts[1].success, false);
    assert.strictEqual(
      body.data.attempts[1].error.reason,
      CHECKOUT_REASONS.BOOKABLE_UNAVAILABLE,
    );
  });

  it("sums totals when all attempts are valid", async function () {
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: [] });
    sandbox.stub(BookableManager, "getBookable").resolves(groupBookable());
    sandbox
      .stub(BundleCheckoutService.prototype, "validateAndGetPrices")
      .resolves({
        regularPriceEur: 50,
        userPriceEur: 50,
        regularGrossPriceEur: 59.5,
        userGrossPriceEur: 59.5,
        freeBookingAllowed: false,
        bookingDiscountPercent: 0,
      });

    const res = response(sandbox);

    await CheckoutControllerV2.validateGroup(
      {
        params: { tenant: TENANT_ID },
        user: { id: "user-1" },
        body: {
          checkoutId: "01fixed",
          bookableItems: [{ bookableId: "room-a", amount: 1 }],
          bookingAttempts: [
            { timeBegin: 1000, timeEnd: 2000 },
            { timeBegin: 3000, timeEnd: 4000 },
          ],
        },
      },
      res,
    );

    const body = res.json.firstCall.args[0];
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.allValid, true);
    assert.deepStrictEqual(body.data.totals, {
      regularPriceEur: 100,
      userPriceEur: 100,
      regularGrossPriceEur: 119,
      userGrossPriceEur: 119,
    });
  });
});

describe("withMandatoryAddons", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("appends missing mandatory addons", async function () {
    sinon.stub(BookableManager, "getBookable").callsFake(async (id) => {
      if (id === "room-a") {
        return {
          id: "room-a",
          checkoutBookableIds: [
            { bookableId: "addon-1", mandatory: true },
            { bookableId: "addon-2", mandatory: false },
          ],
        };
      }
      return { id, checkoutBookableIds: [] };
    });

    const items = await withMandatoryAddons(
      [{ bookableId: "room-a", amount: 2 }],
      TENANT_ID,
    );

    assert.deepStrictEqual(items, [
      { bookableId: "room-a", amount: 2 },
      { bookableId: "addon-1", amount: 2 },
    ]);
  });
});

describe("CheckoutControllerV2._sumAttemptTotals", function () {
  it("sums only successful attempts", function () {
    const totals = CheckoutControllerV2._sumAttemptTotals([
      {
        success: true,
        data: {
          regularPriceEur: 10,
          userPriceEur: 8,
          regularGrossPriceEur: 11.9,
          userGrossPriceEur: 9.52,
        },
      },
      { success: false },
      {
        success: true,
        data: {
          regularPriceEur: 5,
          userPriceEur: 5,
          regularGrossPriceEur: 5.95,
          userGrossPriceEur: 5.95,
        },
      },
    ]);

    assert.deepStrictEqual(totals, {
      regularPriceEur: 15,
      userPriceEur: 13,
      regularGrossPriceEur: 17.85,
      userGrossPriceEur: 15.47,
    });
  });
});
