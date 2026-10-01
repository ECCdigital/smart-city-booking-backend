/**
 * The favorites list routes (glossary "Favoritenliste", ticket 73 of the
 * favorites map) over the lifecycle harness: `GET /api/v2/favorites` -
 * the references, with which a catalog view colours the heart - and `GET
 * /api/v2/favorites/offers` - the entries with their state and, where
 * available, the offer in its public projection - across every tenant or
 * narrowed by `?tenant=`. The list is the user's alone, whoever they are
 * in a tenant; the state is decided when the list is read: a tenant
 * without a public projection makes its entries `unavailable`, an offer
 * that is gone makes its entry `deleted`, and no favorite disappears.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  TENANT_B,
  ADMIN,
  OWNER,
  OWNER_B,
  ROLE_HOLDER,
  READ_OWN_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const FavoriteManager = require("../src/commons/data-managers/favorite-manager");

const A = TENANT;
const B = TENANT_B;
const FX = FIXTURE_ID;
const MINE = "mine";
const FX_B = "fx-b";

describe("favorite routes: reading the favorites list", function () {
  this.timeout(30000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FX]: bookable({ id: FX, title: "Fixture", ownerUserId: ROLE_HOLDER }),
      },
    });
    installRouteWorld({
      tenantId: A,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
      tenants: { [B]: h.tenantB },
      owned: [
        { id: MINE, tenantId: A, ownerUserId: READ_OWN_HOLDER },
        { id: FX_B, tenantId: B, ownerUserId: OWNER_B },
      ],
      groups: h.groups,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(async function () {
    h.tenant.supervisionLevel = "free";
    delete h.tenant.supervisionChangedAt;
    delete h.tenant.supervisionReason;
    for (const userId of [CUSTOMER, ADMIN, OWNER, OWNER_B, READ_OWN_HOLDER]) {
      await FavoriteManager.removeFavoritesOfUser(userId);
    }
  });

  const get = (userId, path) => {
    let req = h.api().get(path);
    if (userId) req = req.set(h.as(userId));
    return req;
  };
  const mark = (userId, tenant, targetType, targetId) =>
    h
      .api()
      .put(`/api/v2/${tenant}/favorites/${targetType}/${targetId}`)
      .set(h.as(userId));

  /** The references of a list answer, as `[tenantId, targetType, targetId]`. */
  const refs = (body) =>
    body.map(({ tenantId, targetType, targetId }) => [
      tenantId,
      targetType,
      targetId,
    ]);
  /** The entries of the hydrated answer, as `[targetId, status, has an offer]`. */
  const states = (body) =>
    body.map(({ targetId, status, offer }) => [
      targetId,
      status,
      offer !== undefined,
    ]);

  describe("anonymous", function () {
    it("is refused at both routes (401): favorites need an account", async function () {
      expect((await get(null, "/api/v2/favorites")).status).to.equal(401);
      expect((await get(null, "/api/v2/favorites/offers")).status).to.equal(
        401,
      );
    });
  });

  describe("GET /api/v2/favorites: the references", function () {
    it("answers an empty list for a user without favorites", async function () {
      const res = await get(CUSTOMER, "/api/v2/favorites");

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal([]);
    });

    it("answers the references alone - target and when it was set, no snapshot", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      await mark(CUSTOMER, A, "event", FX);

      const res = await get(CUSTOMER, "/api/v2/favorites");

      expect(res.status).to.equal(200);
      expect(refs(res.body)).to.have.deep.members([
        [A, "bookable", FX],
        [A, "event", FX],
      ]);
      for (const entry of res.body) {
        expect(Object.keys(entry).sort()).to.deep.equal([
          "created",
          "targetId",
          "targetType",
          "tenantId",
        ]);
      }
    });

    it("lists across tenants, and narrows to one with ?tenant=", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      await mark(CUSTOMER, B, "bookable", FX_B);

      const all = await get(CUSTOMER, "/api/v2/favorites");
      const inB = await get(CUSTOMER, `/api/v2/favorites?tenant=${B}`);
      const nowhere = await get(CUSTOMER, "/api/v2/favorites?tenant=unknown");

      expect(refs(all.body)).to.have.deep.members([
        [A, "bookable", FX],
        [B, "bookable", FX_B],
      ]);
      expect(refs(inB.body)).to.deep.equal([[B, "bookable", FX_B]]);
      expect(nowhere.body).to.deep.equal([]);
    });

    it("answers the user's own list and nobody else's: the instance owner and a tenant owner see nothing of the customer's", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      await mark(OWNER, A, "event", FX);

      expect(
        refs((await get(CUSTOMER, "/api/v2/favorites")).body),
      ).to.deep.equal([[A, "bookable", FX]]);
      expect(refs((await get(OWNER, "/api/v2/favorites")).body)).to.deep.equal([
        [A, "event", FX],
      ]);
      expect((await get(ADMIN, "/api/v2/favorites")).body).to.deep.equal([]);
      expect((await get(OWNER_B, "/api/v2/favorites")).body).to.deep.equal([]);
    });

    it("refuses a tenant filter that is not one value (400 favorite.invalid_tenant_filter)", async function () {
      const res = await get(
        CUSTOMER,
        `/api/v2/favorites?tenant=${A}&tenant=${B}`,
      );

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("favorite.invalid_tenant_filter");
    });
  });

  describe("GET /api/v2/favorites/offers: the entries with their state", function () {
    it("answers an available bookable with the snapshot and the offer in its public projection", async function () {
      await mark(CUSTOMER, A, "bookable", FX);

      const res = await get(CUSTOMER, "/api/v2/favorites/offers");

      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(1);
      expect(res.body[0]).to.include({
        tenantId: A,
        targetType: "bookable",
        targetId: FX,
        title: "Fixture",
        tenantName: h.tenant.name,
        status: "available",
      });
      expect(res.body[0]).to.have.property("created");
      expect(res.body[0]).to.not.have.property("userId");
      expect(res.body[0].offer).to.include({ id: FX, title: "Fixture" });
      expect(res.body[0].offer).to.have.property("imgUrl");
      expect(res.body[0].offer).to.not.have.property("review");
    });

    it("answers an available event with the event as the public gets it", async function () {
      await mark(CUSTOMER, A, "event", FX);

      const res = await get(CUSTOMER, "/api/v2/favorites/offers");

      expect(states(res.body)).to.deep.equal([[FX, "available", true]]);
      expect(res.body[0].title).to.equal("Sommerkonzert");
      expect(res.body[0].offer.information.name).to.equal("Sommerkonzert");
      expect(res.body[0].offer).to.not.have.property("review");
    });

    it("answers unavailable, without an offer, once the tenant has no public projection - the favorite stays", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      await mark(CUSTOMER, A, "event", FX);
      h.tenant.supervisionLevel = "pending";
      h.tenant.supervisionChangedAt = new Date("2026-09-24T10:00:00.000Z");

      const res = await get(CUSTOMER, "/api/v2/favorites/offers");

      expect(res.status).to.equal(200);
      expect(states(res.body)).to.have.deep.members([
        [FX, "unavailable", false],
        [FX, "unavailable", false],
      ]);
      expect(res.body.map((entry) => entry.title)).to.have.members([
        "Fixture",
        "Sommerkonzert",
      ]);
      expect(
        refs((await get(CUSTOMER, "/api/v2/favorites")).body),
      ).to.have.length(2);
    });

    it("answers deleted, with the snapshot, once the offer is gone - the favorite stays", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      const fixture = h.bookables[FX];
      delete h.bookables[FX];
      try {
        const res = await get(CUSTOMER, "/api/v2/favorites/offers");

        expect(res.status).to.equal(200);
        expect(states(res.body)).to.deep.equal([[FX, "deleted", false]]);
        expect(res.body[0]).to.include({
          title: "Fixture",
          tenantName: h.tenant.name,
        });
      } finally {
        h.bookables[FX] = fixture;
      }
    });

    it("tells the three states apart in one list across tenants, and narrows with ?tenant=", async function () {
      await mark(CUSTOMER, A, "bookable", FX);
      await mark(CUSTOMER, A, "bookable", MINE);
      await mark(CUSTOMER, B, "bookable", FX_B);
      const mine = h.bookables[MINE];
      delete h.bookables[MINE];
      h.tenantB.supervisionLevel = "pending";
      try {
        const all = await get(CUSTOMER, "/api/v2/favorites/offers");
        const inA = await get(CUSTOMER, `/api/v2/favorites/offers?tenant=${A}`);

        expect(states(all.body)).to.have.deep.members([
          [FX, "available", true],
          [MINE, "deleted", false],
          [FX_B, "unavailable", false],
        ]);
        expect(states(inA.body)).to.have.deep.members([
          [FX, "available", true],
          [MINE, "deleted", false],
        ]);
      } finally {
        h.bookables[MINE] = mine;
        h.tenantB.supervisionLevel = "free";
      }
    });

    it("answers the user's own entries and nobody else's", async function () {
      await mark(CUSTOMER, A, "bookable", FX);

      expect((await get(ADMIN, "/api/v2/favorites/offers")).body).to.deep.equal(
        [],
      );
      expect(
        (await get(READ_OWN_HOLDER, "/api/v2/favorites/offers")).body,
      ).to.deep.equal([]);
    });
  });
});
