const assert = require("assert");
const sinon = require("sinon");
const checkoutPolicy = require("../src/commons/services/checkout/checkout-policy");
const { CheckoutPolicy } = checkoutPolicy;
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

const TENANT_ID = "tenant-1";

describe("checkout-policy interpretation", function () {
  const table = [
    {
      policy: CheckoutPolicy.SELF_SERVICE,
      runsChecks: true,
      resolvesMandatoryAddons: true,
      requiresInvoicePermission: true,
      acceptsAdminOverrides: false,
    },
    {
      policy: CheckoutPolicy.ADMIN_MANUAL,
      runsChecks: false,
      resolvesMandatoryAddons: false,
      requiresInvoicePermission: false,
      acceptsAdminOverrides: true,
    },
  ];

  for (const row of table) {
    it(`interprets ${row.policy}`, function () {
      assert.strictEqual(checkoutPolicy.runsChecks(row.policy), row.runsChecks);
      assert.strictEqual(
        checkoutPolicy.resolvesMandatoryAddons(row.policy),
        row.resolvesMandatoryAddons,
      );
      assert.strictEqual(
        checkoutPolicy.requiresInvoicePermission(row.policy),
        row.requiresInvoicePermission,
      );
      assert.strictEqual(
        checkoutPolicy.acceptsAdminOverrides(row.policy),
        row.acceptsAdminOverrides,
      );
    });
  }

  it("honors the discount waiver only under SELF_SERVICE", function () {
    assert.strictEqual(
      checkoutPolicy.bookWithoutDiscount(CheckoutPolicy.SELF_SERVICE, false),
      false,
    );
    assert.strictEqual(
      checkoutPolicy.bookWithoutDiscount(CheckoutPolicy.SELF_SERVICE, true),
      true,
    );
    assert.strictEqual(
      checkoutPolicy.bookWithoutDiscount(CheckoutPolicy.ADMIN_MANUAL, false),
      true,
    );
    assert.strictEqual(
      checkoutPolicy.bookWithoutDiscount(CheckoutPolicy.ADMIN_MANUAL, true),
      true,
    );
  });

  it("rejects an unknown policy", function () {
    assert.throws(() => checkoutPolicy.assertCheckoutPolicy("adminish"));
    assert.throws(
      () => new ItemCheckoutService({ tenantId: TENANT_ID }, "adminish"),
    );
  });
});

describe("BundleCheckoutService policy seam", function () {
  it("refuses adminOverrides under SELF_SERVICE", function () {
    assert.throws(
      () =>
        new BundleCheckoutService(
          { tenant: TENANT_ID, bookableItems: [] },
          CheckoutPolicy.SELF_SERVICE,
          { isCommitted: true },
        ),
      /ADMIN_MANUAL/,
    );
  });

  it("suppresses discounts under ADMIN_MANUAL regardless of the request wish", function () {
    const service = new BundleCheckoutService(
      { tenant: TENANT_ID, bookableItems: [], bookWithoutDiscount: false },
      CheckoutPolicy.ADMIN_MANUAL,
    );
    assert.strictEqual(service.bookWithoutDiscount, true);
  });
});

describe("ItemCheckoutService policy behaviour", function () {
  afterEach(function () {
    sinon.restore();
  });

  function itemService(policy) {
    return new ItemCheckoutService(
      {
        user: "user-1",
        tenantId: TENANT_ID,
        timeBegin: Date.now(),
        timeEnd: Date.now() + 3600000,
        bookableId: "room-a",
        amount: 1,
        couponCode: null,
      },
      policy,
    );
  }

  const CHECK_METHODS = [
    "checkPermissions",
    "checkOpeningHours",
    "checkMaxAmount",
    "checkBlockPeriod",
    "checkTimePeriod",
    "checkBookingDuration",
    "checkAvailability",
    "checkEventDate",
    "checkEventSeats",
    "checkParentAvailability",
    "checkChildBookings",
    "checkMaxBookingDate",
    "checkMinBookingLeadTime",
  ];

  it("runs every check under SELF_SERVICE", async function () {
    const service = itemService(CheckoutPolicy.SELF_SERVICE);
    const stubs = CHECK_METHODS.map((name) =>
      sinon.stub(service, name).resolves(true),
    );

    await service.checkAll();

    for (const stub of stubs) {
      assert.strictEqual(stub.calledOnce, true);
    }
  });

  it("runs no check at all under ADMIN_MANUAL", async function () {
    const service = itemService(CheckoutPolicy.ADMIN_MANUAL);
    const stubs = CHECK_METHODS.map((name) =>
      sinon.stub(service, name).resolves(true),
    );

    assert.strictEqual(await service.checkAll(), true);

    for (const stub of stubs) {
      assert.strictEqual(stub.called, false);
    }
  });

  it("uses a provided bookable snapshot without loading from the database", async function () {
    const service = itemService(CheckoutPolicy.SELF_SERVICE);
    const getBookable = sinon.stub(BookableManager, "getBookable");
    const snapshot = { id: "room-a", tenantId: TENANT_ID, title: "Edited" };

    await service.init(snapshot);

    assert.strictEqual(getBookable.called, false);
    assert.ok(service.bookableUsed instanceof Bookable);
    assert.strictEqual(service.bookableUsed.title, "Edited");
  });

  it("loads the bookable when no snapshot is provided", async function () {
    const service = itemService(CheckoutPolicy.SELF_SERVICE);
    const stored = new Bookable({ id: "room-a", tenantId: TENANT_ID });
    sinon.stub(BookableManager, "getBookable").resolves(stored);

    await service.init();

    assert.strictEqual(service.bookableUsed, stored);
  });
});
