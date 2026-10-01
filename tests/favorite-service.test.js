/**
 * The favorite service (glossary "Favorit"): a user marks what they reach
 * at this moment - the offer is read with the reach the route decided -
 * and the favorite carries the snapshot of title and tenant name; a second
 * mark answers the existing favorite; the limit per user refuses with
 * `favorite.limit_reached`; removing is idempotent.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const FavoriteService = require("../src/commons/services/favorite/favorite-service");
const FavoriteManager = require("../src/commons/data-managers/favorite-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const { Favorite } = require("../src/commons/entities/favorite/favorite");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { Event } = require("../src/commons/entities/event/event");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { DOMAIN } = require("../src/commons/services/authorization/reach");
const { NotFoundError } = require("../src/errors/BaseError");

const USER = "erika@example.test";
const TENANT = "tenant-1";
/** The reaches a route hands in: the public's read of the offers. */
const PUBLIC_READS = Object.freeze({
  write: "self",
  "bookable.readPublic": "public",
  "event.read": "public",
  userId: USER,
});

const room = () =>
  new Bookable({ id: "room", tenantId: TENANT, title: "Raum", type: "room" });
const concert = () =>
  new Event({
    id: "E1",
    tenantId: TENANT,
    information: { name: "Sommerkonzert" },
  });
const tenant = () => new Tenant({ id: TENANT, name: "Stadt Musterhausen" });

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("FavoriteService", function () {
  let savedLimit;

  beforeEach(function () {
    savedLimit = process.env.FAVORITES_MAX_PER_USER;
    delete process.env.FAVORITES_MAX_PER_USER;
    sinon.stub(TenantManager, "getTenant").resolves(tenant());
    sinon.stub(FavoriteManager, "getFavorite").resolves(null);
    sinon.stub(FavoriteManager, "countFavorites").resolves(0);
    sinon
      .stub(FavoriteManager, "storeFavorite")
      .callsFake(async (favorite) => favorite);
    sinon.stub(FavoriteManager, "removeFavorite").resolves();
  });

  afterEach(function () {
    sinon.restore();
    if (savedLimit === undefined) delete process.env.FAVORITES_MAX_PER_USER;
    else process.env.FAVORITES_MAX_PER_USER = savedLimit;
  });

  describe("markFavorite", function () {
    it("reads a bookable with the reach of its entry and stores the snapshot", async function () {
      const getBookable = sinon
        .stub(BookableManager, "getBookable")
        .resolves(room());

      const favorite = await FavoriteService.markFavorite({
        userId: USER,
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        reaches: PUBLIC_READS,
      });

      expect(getBookable.firstCall.args).to.deep.equal([
        "room",
        TENANT,
        { reach: "public", userId: USER },
      ]);
      expect(TenantManager.getTenant.calledOnceWithExactly(TENANT, DOMAIN)).to
        .be.true;
      expect(favorite).to.be.instanceOf(Favorite);
      expect(favorite.toResponse()).to.include({
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        title: "Raum",
        tenantName: "Stadt Musterhausen",
      });
      expect(favorite.userId).to.equal(USER);
      expect(favorite.created).to.be.instanceOf(Date);
    });

    it("reads an event with the reach of its entry and takes its name as the title", async function () {
      const getEvent = sinon.stub(EventManager, "getEvent").resolves(concert());

      const favorite = await FavoriteService.markFavorite({
        userId: USER,
        tenantId: TENANT,
        targetType: "event",
        targetId: "E1",
        reaches: { ...PUBLIC_READS, "event.read": "any" },
      });

      expect(getEvent.firstCall.args).to.deep.equal([
        "E1",
        TENANT,
        { reach: "any", userId: USER },
      ]);
      expect(favorite.title).to.equal("Sommerkonzert");
      expect(favorite.targetType).to.equal("event");
    });

    it("answers 404 for an offer the user does not reach, and stores nothing", async function () {
      sinon.stub(BookableManager, "getBookable").resolves(null);

      const error = await rejection(
        FavoriteService.markFavorite({
          userId: USER,
          tenantId: TENANT,
          targetType: "bookable",
          targetId: "ghost",
          reaches: PUBLIC_READS,
        }),
      );

      expect(error).to.be.instanceOf(NotFoundError);
      expect(error.code).to.equal("favorite.offer_not_found");
      expect(FavoriteManager.storeFavorite.called).to.equal(false);
    });

    it("lets the public's 404 of a tenant without a projection through", async function () {
      sinon
        .stub(BookableManager, "getBookable")
        .rejects(new NotFoundError("tenant_not_found", { tenantId: TENANT }));

      const error = await rejection(
        FavoriteService.markFavorite({
          userId: USER,
          tenantId: TENANT,
          targetType: "bookable",
          targetId: "room",
          reaches: PUBLIC_READS,
        }),
      );

      expect(error.statusCode).to.equal(404);
      expect(error.code).to.equal("tenant_not_found");
    });

    it("answers the existing favorite for a second mark, without counting or writing", async function () {
      sinon.stub(BookableManager, "getBookable").resolves(room());
      const existing = Favorite.create({
        userId: USER,
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        title: "Alter Titel",
        tenantName: "Alter Name",
      });
      FavoriteManager.getFavorite.resolves(existing);
      FavoriteManager.countFavorites.resolves(500);

      const favorite = await FavoriteService.markFavorite({
        userId: USER,
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        reaches: PUBLIC_READS,
      });

      expect(favorite).to.equal(existing);
      expect(favorite.title).to.equal("Alter Titel");
      expect(FavoriteManager.storeFavorite.called).to.equal(false);
    });

    it("refuses at the limit with favorite.limit_reached (409)", async function () {
      sinon.stub(BookableManager, "getBookable").resolves(room());
      process.env.FAVORITES_MAX_PER_USER = "2";
      FavoriteManager.countFavorites.resolves(2);

      const error = await rejection(
        FavoriteService.markFavorite({
          userId: USER,
          tenantId: TENANT,
          targetType: "bookable",
          targetId: "room",
          reaches: PUBLIC_READS,
        }),
      );

      expect(error.statusCode).to.equal(409);
      expect(error.code).to.equal("favorite.limit_reached");
      expect(error.params).to.deep.equal({ limit: 2 });
      expect(FavoriteManager.storeFavorite.called).to.equal(false);
    });

    it("stores below the limit", async function () {
      sinon.stub(BookableManager, "getBookable").resolves(room());
      process.env.FAVORITES_MAX_PER_USER = "2";
      FavoriteManager.countFavorites.resolves(1);

      await FavoriteService.markFavorite({
        userId: USER,
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        reaches: PUBLIC_READS,
      });

      expect(FavoriteManager.storeFavorite.calledOnce).to.equal(true);
    });

    it("takes the default limit for a value that is no positive integer", function () {
      expect(FavoriteService.maxFavoritesPerUser()).to.equal(
        FavoriteService.DEFAULT_MAX_FAVORITES_PER_USER,
      );
      process.env.FAVORITES_MAX_PER_USER = "lots";
      expect(FavoriteService.maxFavoritesPerUser()).to.equal(
        FavoriteService.DEFAULT_MAX_FAVORITES_PER_USER,
      );
      process.env.FAVORITES_MAX_PER_USER = "0";
      expect(FavoriteService.maxFavoritesPerUser()).to.equal(
        FavoriteService.DEFAULT_MAX_FAVORITES_PER_USER,
      );
      process.env.FAVORITES_MAX_PER_USER = "50";
      expect(FavoriteService.maxFavoritesPerUser()).to.equal(50);
    });

    it("refuses a target type that is neither bookable nor event (400)", async function () {
      const getBookable = sinon.stub(BookableManager, "getBookable");

      const error = await rejection(
        FavoriteService.markFavorite({
          userId: USER,
          tenantId: TENANT,
          targetType: "ticket",
          targetId: "room",
          reaches: PUBLIC_READS,
        }),
      );

      expect(error.statusCode).to.equal(400);
      expect(error.code).to.equal("favorite.invalid_target_type");
      expect(getBookable.called).to.equal(false);
    });
  });

  describe("unmarkFavorite", function () {
    it("removes the favorite of the user by its target", async function () {
      await FavoriteService.unmarkFavorite({
        userId: USER,
        tenantId: TENANT,
        targetType: "event",
        targetId: "E1",
      });

      expect(
        FavoriteManager.removeFavorite.calledOnceWithExactly(
          USER,
          TENANT,
          "event",
          "E1",
        ),
      ).to.equal(true);
    });

    it("refuses a target type that is neither bookable nor event (400)", async function () {
      const error = await rejection(
        FavoriteService.unmarkFavorite({
          userId: USER,
          tenantId: TENANT,
          targetType: "ticket",
          targetId: "E1",
        }),
      );

      expect(error.statusCode).to.equal(400);
      expect(FavoriteManager.removeFavorite.called).to.equal(false);
    });
  });
});
