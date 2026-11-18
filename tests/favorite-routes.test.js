/**
 * The favorite routes (glossary "Favorit", ticket 72 of the favorites
 * map) over the lifecycle harness: `PUT` and `DELETE
 * /api/v2/:tenant/favorites/:targetType/:targetId`, both idempotent. A
 * favorite is the signed-in user's alone - another user's or the instance
 * owner's mark is their own and never touches it - and a user marks only
 * what they reach at this moment: a tenant without a public projection has
 * nothing to mark for the public, staff keep their management view.
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
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const A = TENANT;
const B = TENANT_B;
const FX = FIXTURE_ID;
const MINE = "mine";
const FX_B = "fx-b";

const path = (tenant, targetType, targetId) =>
  `/api/v2/${tenant}/favorites/${targetType}/${targetId}`;

describe("favorite routes: marking and removing a favorite", function () {
  this.timeout(30000);

  let h;
  let savedLimit;

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

  beforeEach(function () {
    savedLimit = process.env.FAVORITES_MAX_PER_USER;
    delete process.env.FAVORITES_MAX_PER_USER;
  });

  afterEach(async function () {
    if (savedLimit === undefined) delete process.env.FAVORITES_MAX_PER_USER;
    else process.env.FAVORITES_MAX_PER_USER = savedLimit;
    h.tenant.supervisionLevel = "free";
    delete h.tenant.supervisionChangedAt;
    delete h.tenant.supervisionReason;
    for (const userId of [CUSTOMER, ADMIN, OWNER, OWNER_B, READ_OWN_HOLDER]) {
      await FavoriteManager.removeFavoritesOfUser(userId);
    }
  });

  /** The favorites of a user in the world, as `[tenantId, targetType, targetId]`. */
  const favoritesOf = async (userId) =>
    (await FavoriteManager.getFavorites(userId, null, DOMAIN)).map(
      ({ tenantId, targetType, targetId }) => [tenantId, targetType, targetId],
    );

  const put = (userId, tenant, targetType, targetId) => {
    let req = h.api().put(path(tenant, targetType, targetId));
    if (userId) req = req.set(h.as(userId));
    return req;
  };
  const del = (userId, tenant, targetType, targetId) => {
    let req = h.api().delete(path(tenant, targetType, targetId));
    if (userId) req = req.set(h.as(userId));
    return req;
  };

  describe("anonymous", function () {
    it("is refused at both routes (401): favorites need an account", async function () {
      expect((await put(null, A, "bookable", FX)).status).to.equal(401);
      expect((await del(null, A, "bookable", FX)).status).to.equal(401);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([]);
    });
  });

  describe("PUT: marking", function () {
    it("marks a bookable the public reaches and answers the favorite (200)", async function () {
      const res = await put(CUSTOMER, A, "bookable", FX);

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        tenantId: A,
        targetType: "bookable",
        targetId: FX,
        title: "Fixture",
        tenantName: h.tenant.name,
      });
      expect(res.body).to.have.property("created");
      expect(res.body).to.not.have.property("userId");
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([[A, "bookable", FX]]);
    });

    it("marks an event the public reaches, with its name as the title", async function () {
      const res = await put(CUSTOMER, A, "event", FX);

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        targetType: "event",
        targetId: FX,
        title: "Sommerkonzert",
      });
    });

    it("is idempotent: a second mark answers the same entry and adds none", async function () {
      const first = await put(CUSTOMER, A, "bookable", FX);
      const second = await put(CUSTOMER, A, "bookable", FX);

      expect(second.status).to.equal(200);
      expect(second.body).to.deep.equal(first.body);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([[A, "bookable", FX]]);
    });

    it("answers 404 for an offer that is not there", async function () {
      const res = await put(CUSTOMER, A, "bookable", "ghost");

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("favorite.offer_not_found");
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([]);
    });

    it("answers 400 for a target type that is neither bookable nor event", async function () {
      const res = await put(CUSTOMER, A, "ticket", FX);

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("favorite.invalid_target_type");
    });

    it("refuses at the limit with 409 favorite.limit_reached, and keeps an existing mark", async function () {
      process.env.FAVORITES_MAX_PER_USER = "1";
      expect((await put(CUSTOMER, A, "bookable", FX)).status).to.equal(200);

      const res = await put(CUSTOMER, A, "event", FX);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("favorite.limit_reached");
      expect(res.body.params).to.deep.equal({ limit: 1 });
      // The one already marked is still answered, not refused.
      expect((await put(CUSTOMER, A, "bookable", FX)).status).to.equal(200);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([[A, "bookable", FX]]);
    });

    it("marks for whoever asks: the owner of another tenant and the instance owner mark their own", async function () {
      expect((await put(OWNER_B, A, "bookable", FX)).status).to.equal(200);
      expect((await put(ADMIN, A, "bookable", FX)).status).to.equal(200);
      expect((await put(CUSTOMER, B, "bookable", FX_B)).status).to.equal(200);

      expect(await favoritesOf(OWNER_B)).to.deep.equal([[A, "bookable", FX]]);
      expect(await favoritesOf(ADMIN)).to.deep.equal([[A, "bookable", FX]]);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([
        [B, "bookable", FX_B],
      ]);
    });
  });

  describe("PUT: a tenant without a public projection", function () {
    beforeEach(function () {
      h.tenant.supervisionLevel = "pending";
      h.tenant.supervisionChangedAt = new Date("2026-09-24T10:00:00.000Z");
    });

    it("has nothing to mark for the public (404 tenant_not_found)", async function () {
      const res = await put(CUSTOMER, A, "bookable", FX);

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("tenant_not_found");
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([]);
    });

    it("keeps the staff's management view: the owner marks (200)", async function () {
      expect((await put(OWNER, A, "bookable", FX)).status).to.equal(200);
      expect(await favoritesOf(OWNER)).to.deep.equal([[A, "bookable", FX]]);
    });
  });

  describe("DELETE: removing", function () {
    it("removes the favorite and answers 204, and 204 again without one", async function () {
      await put(CUSTOMER, A, "bookable", FX);

      expect((await del(CUSTOMER, A, "bookable", FX)).status).to.equal(204);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([]);
      expect((await del(CUSTOMER, A, "bookable", FX)).status).to.equal(204);
    });

    it("removes nothing of anyone else: another user's and the instance owner's remove leave the mark", async function () {
      await put(CUSTOMER, A, "bookable", FX);

      expect((await del(OWNER_B, A, "bookable", FX)).status).to.equal(204);
      expect((await del(ADMIN, A, "bookable", FX)).status).to.equal(204);
      expect((await del(OWNER, A, "bookable", FX)).status).to.equal(204);

      expect(await favoritesOf(CUSTOMER)).to.deep.equal([[A, "bookable", FX]]);
    });

    it("removes under a tenant without a public projection too: the mark is the user's", async function () {
      await put(CUSTOMER, A, "bookable", FX);
      h.tenant.supervisionLevel = "pending";

      expect((await del(CUSTOMER, A, "bookable", FX)).status).to.equal(204);
      expect(await favoritesOf(CUSTOMER)).to.deep.equal([]);
    });

    it("answers 400 for a target type that is neither bookable nor event", async function () {
      expect((await del(CUSTOMER, A, "ticket", FX)).status).to.equal(400);
    });
  });
});
