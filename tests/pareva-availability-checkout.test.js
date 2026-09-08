/**
 * The Pareva Anlage at the checkout (docs/specs/pareva-anlage.md of the
 * admin UI, decisions 4-10): a Pareva Anlage is a product, its stock is
 * Pareva's, and the checkout asks Pareva live how many compartments of the
 * product are free in the window. The platform's own count against
 * `bookable.amount` and Pareva's answer both have to pass; a Pareva that
 * cannot answer leaves the decision to the platform count.
 */

const assert = require("assert");
const sinon = require("sinon");
const ParevaApiClient = require("../src/commons/services/access/clients/pareva-api-client");
const ParevaCheckoutProvider = require("../src/commons/services/checkout/providers/pareva-checkout-provider");
const IfbsCheckoutProvider = require("../src/commons/services/checkout/providers/ifbs-checkout-provider");
const providerRegistry = require("../src/commons/services/checkout/providers/register");
const {
  ItemCheckoutService,
  CHECK_TYPES,
} = require("../src/commons/services/checkout/item-checkout-service");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const {
  FakeParevaApiClient,
  brokenParevaApiClient,
  parevaHttpError,
} = require("./helpers/fake-pareva-api-client");

const LOCKER_ID = "L1";
/** The Produkt-ID of the Anlage: a 24-hex id, as Pareva names a product. */
const PRODUCT_ID = "66570d1a1f9b6357ed971746";
const TIME_BEGIN = Date.UTC(2027, 5, 21, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 21, 12, 0, 0);

const TENANT = "tenant-1";

/** The Anlage: a Pareva product of the tenant's locker system. */
const ANLAGE = {
  id: "anlage-1",
  tenantId: TENANT,
  type: "locker",
  provider: "pareva",
  externalId: PRODUCT_ID,
  providerLocationId: LOCKER_ID,
  label: "Schließfach",
  mode: "authorization",
  validationRules: [],
};

function parevaWith(free) {
  return new FakeParevaApiClient({
    lockerId: LOCKER_ID,
    sizes: [{ size: PRODUCT_ID, free }],
  });
}

/** A locker bookable at the Anlage, `amount` compartments on offer. */
function lockerBookable(overrides = {}) {
  return new Bookable({
    id: "locker",
    tenantId: TENANT,
    title: "Schließfach",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 5,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-item",
    priceValueAddedTax: 0,
    priceCategories: [{ priceEur: 5, interval: { start: null, end: null } }],
    accessPointDetails: { active: true, accessPointIds: [ANLAGE.id] },
    ...overrides,
  });
}

function checkoutProvider(client, overrides = {}) {
  return new ParevaCheckoutProvider(client, {
    bookable: lockerBookable(),
    unit: { accessPoints: [ANLAGE] },
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
    amount: 1,
    tenantId: TENANT,
    ...overrides,
  });
}

describe("Pareva availability at the checkout", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("ParevaApiClient.getAvailableAssignments: the live check", function () {
    it("asks rental/available?v=2 for the product in the window and answers the entries", async function () {
      const client = parevaWith(3);

      const entries = await client.getAvailableAssignments(
        PRODUCT_ID,
        TIME_BEGIN,
        TIME_END,
      );

      assert.strictEqual(entries.length, 3);
      assert.deepStrictEqual(client.availabilityRequests, [
        { productId: PRODUCT_ID, begin: TIME_BEGIN, end: TIME_END },
      ]);
    });

    it("counts an open rental of the product in the window as taken", async function () {
      const client = parevaWith(2);
      await client.startRental(PRODUCT_ID, {
        email: "erika@example.test",
        fromEmail: "tenant@example.test",
        plannedBegin: TIME_BEGIN,
        plannedEnd: TIME_END,
      });

      const entries = await client.getAvailableAssignments(
        PRODUCT_ID,
        TIME_BEGIN,
        TIME_END,
      );

      assert.strictEqual(entries.length, 1);
    });

    it("rethrows Pareva's own error, a product it does not have included", async function () {
      const client = parevaWith(1);

      await assert.rejects(
        client.getAvailableAssignments("S", TIME_BEGIN, TIME_END),
        (err) => err.response?.status === 404,
      );
    });

    it("throws when Pareva answers anything but a list", async function () {
      const client = new ParevaApiClient(
        "https://pareva.fake",
        LOCKER_ID,
        "u",
        "p",
      );
      sinon.stub(client, "_request").resolves({ error: true });

      await assert.rejects(
        client.getAvailableAssignments(PRODUCT_ID, TIME_BEGIN, TIME_END),
        /without a list/,
      );
    });
  });

  describe("ParevaCheckoutProvider.checkAvailability: the product's stock is Pareva's", function () {
    it("narrows the platform count instead of replacing it", function () {
      const provider = checkoutProvider(parevaWith(1));

      assert.strictEqual(provider.handlesAvailability, true);
      assert.strictEqual(provider.narrowsAvailability, true);
    });

    it("answers available when Pareva lists at least as many free compartments as the booking needs", async function () {
      const provider = checkoutProvider(parevaWith(2), { amount: 2 });

      const result = await provider.checkAvailability();

      assert.deepStrictEqual(result, {
        available: true,
        remaining: 2,
        needed: 2,
        externalSource: "pareva",
        productId: PRODUCT_ID,
      });
    });

    it("refuses when Pareva lists fewer free compartments than the booking needs at the product", async function () {
      // Two compartments per booking at this Anlage; Pareva has one free.
      const provider = checkoutProvider(parevaWith(1), {
        bookable: lockerBookable({
          accessPointDetails: {
            active: true,
            accessPointIds: [ANLAGE.id],
            accessPointAmounts: { [ANLAGE.id]: 2 },
          },
        }),
        amount: 1,
      });

      const result = await provider.checkAvailability();

      assert.strictEqual(result.available, false);
      assert.strictEqual(result.remaining, 1);
      assert.strictEqual(result.needed, 2);
      assert.strictEqual(result.externalSource, "pareva");
      assert.strictEqual(result.productId, PRODUCT_ID);
      assert.match(result.message, /Schließfach/);
    });

    it("answers unknown, never a refusal, when Pareva cannot be reached", async function () {
      const provider = checkoutProvider(brokenParevaApiClient());

      const result = await provider.checkAvailability();

      assert.strictEqual(result.available, null);
      assert.strictEqual(result.unknown, true);
      assert.strictEqual(result.externalSource, "pareva");
      assert.match(result.message, /Pareva/);
    });

    it("names the Anlage when Pareva does not know its Produkt-ID - a size code stored as product id", async function () {
      const sizeCodeAnlage = { ...ANLAGE, externalId: "S" };
      const provider = checkoutProvider(parevaWith(1), {
        unit: { accessPoints: [sizeCodeAnlage] },
      });

      const result = await provider.checkAvailability();

      assert.strictEqual(result.unknown, true);
      assert.match(result.message, /anlage-1/);
      assert.match(result.message, /'S'/);
    });

    it("asks Pareva once per product and window across the providers of one check", async function () {
      const client = parevaWith(1);
      const externalCache = new Map();
      const first = checkoutProvider(client, { externalCache });
      const second = checkoutProvider(client, { externalCache });
      const later = checkoutProvider(client, {
        externalCache,
        timeBegin: TIME_END,
        timeEnd: TIME_END + 60 * 60 * 1000,
      });

      await first.checkAvailability();
      await second.checkAvailability();
      await later.checkAvailability();

      assert.strictEqual(client.availabilityRequests.length, 2);
    });
  });

  describe("ItemCheckoutService.checkAvailability: the platform count and Pareva both have to pass", function () {
    let pareva;
    let bookable;
    let tenantApps;
    let concurrentBookings;

    before(function () {
      // The seam builds the provider from the tenant's Pareva app; the
      // fake stands in for the client it would speak to.
      providerRegistry.register(
        "pareva",
        class extends ParevaCheckoutProvider {
          constructor(client, context) {
            super(pareva, context);
          }
        },
      );
    });

    after(function () {
      providerRegistry.register("pareva", ParevaCheckoutProvider);
    });

    const parevaApp = (active = true) => ({
      type: "access",
      id: "pareva",
      active,
      serverUrl: "https://pareva.example.test",
      lockerId: LOCKER_ID,
      user: "user",
      password: "password",
    });

    const ifbsApp = () => ({
      type: "access",
      id: "ifbs",
      active: true,
      serverUrl: "https://ifbs.example.test",
      apiKey: "key",
      secretPhrase: "secret",
    });

    /** A concurrent booking of `amount` of the bookable in the window. */
    const booked = (amount) => ({
      id: `OTHER-${amount}`,
      isRejected: false,
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      bookableItems: [{ bookableId: "locker", amount }],
    });

    beforeEach(function () {
      pareva = parevaWith(1);
      bookable = lockerBookable();
      tenantApps = [parevaApp()];
      concurrentBookings = [];

      sinon
        .stub(BookableManager, "getBookable")
        .callsFake(async () => bookable);
      sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
      sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
      sinon
        .stub(TenantManager, "getTenant")
        .callsFake(async () => ({ id: TENANT, applications: tenantApps }));
      sinon
        .stub(TenantManager, "getTenantAppById")
        .callsFake(
          async (tenantId, appId) =>
            tenantApps.find((app) => app.id === appId) || null,
        );
      sinon
        .stub(BookingManager, "getConcurrentBookings")
        .callsFake(async () => concurrentBookings);
      sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
      sinon
        .stub(AccessPointManager, "getAccessPointsByIds")
        .callsFake(async (tenantId, ids) =>
          [ANLAGE].filter((row) => ids.includes(row.id)),
        );
    });

    async function checkout(amount = 1, externalCache = undefined) {
      const ics = new ItemCheckoutService({
        user: "erika@example.test",
        tenantId: TENANT,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableId: "locker",
        amount,
        externalCache,
      });
      await ics.init();
      return ics;
    }

    function rejectsAvailability(promise, check) {
      return assert.rejects(promise, (err) => {
        assert.strictEqual(err.checkType, CHECK_TYPES.AVAILABILITY);
        assert.strictEqual(err.available, false);
        check(err);
        return true;
      });
    }

    it("refuses when the platform count has room but Pareva has no compartment free", async function () {
      pareva = parevaWith(0);
      const ics = await checkout(1);

      await rejectsAvailability(ics.checkAvailability(), (err) => {
        assert.strictEqual(err.externalSource, "pareva");
        assert.strictEqual(err.remaining, 0);
        assert.strictEqual(err.needed, 1);
        assert.strictEqual(err.productId, PRODUCT_ID);
        assert.match(err.message, /Schließfach/);
      });
    });

    it("refuses on the platform count when it is full, without asking Pareva", async function () {
      bookable = lockerBookable({ amount: 1 });
      concurrentBookings = [booked(1)];
      pareva = parevaWith(5);
      const ics = await checkout(1);

      await rejectsAvailability(ics.checkAvailability(), (err) => {
        assert.strictEqual(err.totalCapacity, 1);
        assert.strictEqual(err.booked, 1);
        assert.notStrictEqual(err.externalSource, "pareva");
      });
      assert.strictEqual(pareva.availabilityRequests.length, 0);
    });

    it("passes when the platform count and Pareva both have room, answering the platform's count", async function () {
      pareva = parevaWith(1);
      const ics = await checkout(1);

      const result = await ics.checkAvailability();

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.totalCapacity, 5);
      assert.strictEqual(result.booked, 0);
      assert.strictEqual(pareva.availabilityRequests.length, 1);
    });

    it("leaves the decision to the platform count when Pareva cannot answer", async function () {
      pareva = brokenParevaApiClient();
      const ics = await checkout(1);

      const result = await ics.checkAvailability();

      assert.strictEqual(result.available, true);
    });

    it("still refuses a full platform count when Pareva cannot answer", async function () {
      pareva = brokenParevaApiClient(parevaHttpError(500));
      bookable = lockerBookable({ amount: 1 });
      concurrentBookings = [booked(1)];
      const ics = await checkout(1);

      await rejectsAvailability(ics.checkAvailability(), () => {});
    });

    it("asks Pareva nothing for a bookable without a Pareva Anlage", async function () {
      bookable = lockerBookable({ accessPointDetails: null });
      const ics = await checkout(1);

      await ics.checkAvailability();

      assert.strictEqual(ics.externalProviders.length, 0);
      assert.strictEqual(pareva.availabilityRequests.length, 0);
    });

    it("asks Pareva nothing while the bookable's access is switched off", async function () {
      bookable = lockerBookable({
        accessPointDetails: { active: false, accessPointIds: [ANLAGE.id] },
      });
      const ics = await checkout(1);

      await ics.checkAvailability();

      assert.strictEqual(pareva.availabilityRequests.length, 0);
    });

    it("asks Pareva nothing when the tenant's Pareva app is switched off", async function () {
      tenantApps = [parevaApp(false)];
      const ics = await checkout(1);

      await ics.checkAvailability();

      assert.strictEqual(ics.externalProviders.length, 0);
      assert.strictEqual(pareva.availabilityRequests.length, 0);
    });

    it("leaves an iFBS bookable to iFBS alone: it replaces the platform count as before", async function () {
      tenantApps = [ifbsApp()];
      bookable = lockerBookable({
        amount: 1,
        accessPointDetails: null,
        externalProviders: [
          {
            provider: "ifbs",
            active: true,
            handles: ["pricing", "availability", "maxAmount"],
            config: { locationId: "7", amount: 1 },
          },
        ],
      });
      concurrentBookings = [booked(1)];
      sinon
        .stub(IfbsCheckoutProvider.prototype, "checkAvailability")
        .resolves({ available: true, remaining: 1, externalSource: "ifbs" });
      const ics = await checkout(1);

      const result = await ics.checkAvailability();

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.externalSource, true);
      assert.strictEqual(BookingManager.getConcurrentBookings.callCount, 0);
    });

    it("keeps the platform count for an iFBS bookable whose declaration does not hand iFBS the availability", async function () {
      tenantApps = [ifbsApp()];
      bookable = lockerBookable({
        amount: 1,
        accessPointDetails: null,
        externalProviders: [
          {
            provider: "ifbs",
            active: true,
            handles: ["pricing"],
            config: { locationId: "7", amount: 1 },
          },
        ],
      });
      concurrentBookings = [booked(1)];
      const ifbsCheck = sinon
        .stub(IfbsCheckoutProvider.prototype, "checkAvailability")
        .resolves({ available: true, externalSource: "ifbs" });
      const ics = await checkout(1);

      await rejectsAvailability(ics.checkAvailability(), (err) => {
        assert.strictEqual(err.totalCapacity, 1);
      });
      assert.strictEqual(ifbsCheck.callCount, 0);
    });

    it("asks Pareva once per product and window for the checks of one calendar render", async function () {
      const externalCache = new Map();
      const first = await checkout(1, externalCache);
      const second = await checkout(1, externalCache);

      await first.checkAvailability();
      await second.checkAvailability();

      assert.strictEqual(pareva.availabilityRequests.length, 1);
    });
  });
});
