/**
 * `POST /api/:tenant/bookables/occupancy` reads the membership of the
 * caller, the tenant and each tenant app once per request, not once per
 * bookable - with the same answers as before.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  CUSTOMER,
  ADMIN,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const providerRegistry = require("../src/commons/services/checkout/providers/register");
const BaseCheckoutProvider = require("../src/commons/services/checkout/providers/base-checkout-provider");
const IfbsCheckoutProvider = require("../src/commons/services/checkout/providers/ifbs-checkout-provider");
const ParevaCheckoutProvider = require("../src/commons/services/checkout/providers/pareva-checkout-provider");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");

const OCCUPANCY = `/api/${TENANT}/bookables/occupancy`;

/** Ten bookables `room-0` to `room-9`, each with `overrides`. */
function tenBookables(overrides = {}) {
  return Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `room-${i}`,
      bookable({ id: `room-${i}`, title: `Raum ${i}`, ...overrides }),
    ]),
  );
}

describe("occupancy of many bookables: one read per request", function () {
  let h;

  // The route counts its ids at the limit per IP (ECCdigital/tickets#1254).
  beforeEach(function () {
    installInMemoryRateLimitEvents();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const postAs = (userId, bookableIds) =>
    h
      .api()
      .post(OCCUPANCY)
      .set(h.as(userId))
      .send({ bookableIds, timeBegin: TIME_BEGIN, timeEnd: TIME_END });

  /** The reads of the caller's membership in the tenant. */
  const membershipReads = () =>
    MembershipManager.getMembershipByTenantAndUserID
      .getCalls()
      .filter((call) => call.args[0] === TENANT && call.args[1] === CUSTOMER)
      .length;

  it("reads the membership of a signed-in caller once and gives every bookable its discount", async function () {
    const bookables = tenBookables({
      bookingDiscounts: {
        users: [{ userId: CUSTOMER, discountPercent: 50 }],
        roles: [],
      },
    });
    h = await installHarness({ bookables });
    const before = membershipReads();

    const res = await postAs(CUSTOMER, Object.keys(bookables));

    expect(res.status).to.equal(200);
    expect(res.body).to.have.length(10);
    for (const occupancy of res.body) {
      // 40 EUR per item, no VAT, half off for the customer.
      expect(occupancy.price).to.deep.equal({
        regularPriceEur: 40,
        userPriceEur: 20,
        regularGrossPriceEur: 40,
        userGrossPriceEur: 20,
        freeBookingAllowed: false,
        bookingDiscountPercent: 50,
      });
    }
    expect(membershipReads() - before).to.equal(1);
  });

  it("does not keep a failed read of the membership: only the bookable that read it misses its price", async function () {
    const bookables = tenBookables({
      bookingDiscounts: {
        users: [{ userId: CUSTOMER, discountPercent: 50 }],
        roles: [],
      },
    });
    h = await installHarness({ bookables });
    // The first read fails, as a database that drops one query; the
    // discount is the customer's own, so any membership will do.
    let failed = false;
    MembershipManager.getMembershipByTenantAndUserID.callsFake(
      async (tenantId, userId) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (!failed) {
          failed = true;
          throw new Error("connection reset");
        }
        return { tenantId, userId, status: "active", roles: [] };
      },
    );

    const res = await postAs(CUSTOMER, Object.keys(bookables));

    expect(res.status).to.equal(200);
    const unpriced = res.body.filter((o) => o.price === null);
    const priced = res.body.filter((o) => o.price !== null);
    expect(unpriced).to.have.length(1);
    expect(priced).to.have.length(9);
    for (const occupancy of priced) {
      expect(occupancy.price.bookingDiscountPercent).to.equal(50);
      expect(occupancy.price.userPriceEur).to.equal(20);
    }
  });

  describe("bookables with external providers", function () {
    // The providers are built as usual; the fakes in their place ask no
    // one, so the checks and the price stay the platform's.
    before(function () {
      providerRegistry.register("ifbs", class extends BaseCheckoutProvider {});
      providerRegistry.register(
        "pareva",
        class extends BaseCheckoutProvider {},
      );
    });

    after(function () {
      providerRegistry.register("ifbs", IfbsCheckoutProvider);
      providerRegistry.register("pareva", ParevaCheckoutProvider);
    });

    const ifbsApp = {
      type: "access",
      id: "ifbs",
      active: true,
      serverUrl: "https://ifbs.example.test",
      apiKey: "key",
      secretPhrase: "secret",
    };
    const parevaApp = {
      type: "access",
      id: "pareva",
      active: true,
      serverUrl: "https://pareva.example.test",
      lockerId: "L1",
      user: "user",
      password: "password",
    };
    const anlage = {
      id: "anlage-1",
      tenantId: TENANT,
      type: "locker",
      provider: "pareva",
      externalId: "66570d1a1f9b6357ed971746",
      providerLocationId: "L1",
    };

    it("reads the tenant once and each tenant app once", async function () {
      const bookables = tenBookables({
        externalProviders: [
          {
            provider: "ifbs",
            active: true,
            handles: [],
            config: { locationId: "loc-1" },
          },
        ],
        accessPointDetails: { active: true, accessPointIds: [anlage.id] },
      });
      h = await installHarness({
        bookables,
        tenant: {
          applications: [
            { type: "payment", id: "invoice", active: true },
            ifbsApp,
            parevaApp,
          ],
        },
      });
      AccessPointManager.getAccessPointsByIds.callsFake(async (tenantId, ids) =>
        [anlage].filter((a) => ids.includes(a.id)),
      );
      sinon
        .stub(TenantManager, "getTenantAppById")
        .callsFake(
          async (tenantId, appId) =>
            [ifbsApp, parevaApp].find((app) => app.id === appId) || null,
        );
      const tenantReads = () =>
        TenantManager.getTenant
          .getCalls()
          .filter(
            (call) =>
              call.args[0] === TENANT && call.args[1]?.reach === "domain",
          ).length;
      const before = tenantReads();

      // As the staff: their read of the bookables is not projected for
      // the public, so every read of the tenant is the checkouts'.
      const res = await postAs(ADMIN, Object.keys(bookables));

      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(10);
      for (const occupancy of res.body) {
        expect(occupancy).to.include({ isAvailable: true });
        expect(occupancy).to.not.have.property("reason");
        expect(occupancy.price).to.include({
          userPriceEur: 40,
          bookingDiscountPercent: 0,
        });
      }
      expect(tenantReads() - before).to.equal(1);
      expect(
        TenantManager.getTenantAppById.getCalls().map((call) => call.args),
      ).to.deep.equal([[TENANT, "ifbs"]]);
    });
  });
});
