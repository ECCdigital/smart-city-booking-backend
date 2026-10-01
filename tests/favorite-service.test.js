/**
 * The favorite service (glossary "Favorit"): a user marks what they reach
 * at this moment - the offer is read with the reach the route decided -
 * and the favorite carries the snapshot of title and tenant name; a second
 * mark answers the existing favorite; the limit per user refuses with
 * `favorite.limit_reached`; removing is idempotent. The list (glossary
 * "Favoritenliste") is the domain's read for the user; the hydrated list
 * decides the state of every entry when it is read - the targets loaded
 * per tenant and kind once as the domain and once as the public through
 * the projection `reached` - `available`, `unavailable` or `deleted`, and
 * no favorite disappears by itself.
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
const {
  DOMAIN,
  PUBLIC,
} = require("../src/commons/services/authorization/reach");
const {
  reached,
} = require("../src/commons/services/supervision/public-projection");
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

const room = (overrides = {}) =>
  new Bookable({
    id: "room",
    tenantId: TENANT,
    title: "Raum",
    type: "room",
    ...overrides,
  });
const concert = (id = "E1") =>
  new Event({
    id,
    tenantId: TENANT,
    information: { name: "Sommerkonzert" },
  });
const tenant = () => new Tenant({ id: TENANT, name: "Stadt Musterhausen" });
/** A favorite of the user with the snapshot the mark took. */
const favoriteOn = (targetType, targetId, tenantId = TENANT) =>
  Favorite.create({
    userId: USER,
    tenantId,
    targetType,
    targetId,
    title: `Titel ${targetId}`,
    tenantName: "Stadt Musterhausen",
  });

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

  describe("getFavorites", function () {
    it("reads the favorites of the user as the domain, across every tenant or within one", async function () {
      const mine = [favoriteOn("bookable", "room")];
      const getFavorites = sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves(mine);

      expect(await FavoriteService.getFavorites({ userId: USER })).to.equal(
        mine,
      );
      expect(getFavorites.firstCall.args).to.deep.equal([USER, null, DOMAIN]);

      await FavoriteService.getFavorites({ userId: USER, tenantId: TENANT });
      expect(getFavorites.secondCall.args).to.deep.equal([
        USER,
        TENANT,
        DOMAIN,
      ]);
    });
  });

  describe("getFavoriteOffers", function () {
    const TENANT_B = "tenant-2";

    /** The hydrated entries, as `[targetId, status, has an offer]`. */
    const states = (entries) =>
      entries.map(({ targetId, status, offer }) => [
        targetId,
        status,
        offer !== undefined,
      ]);

    /** The bookables by id and reach a test answers: `domain` and `public`. */
    function bookablesAnswering(byReach) {
      return sinon
        .stub(BookableManager, "getBookablesByIds")
        .callsFake(async (tenantId, ids, scope) =>
          (byReach[scope.reach] ?? []).filter(
            (offer) => offer.tenantId === tenantId && ids.includes(offer.id),
          ),
        );
    }

    it("loads the bookables of a tenant once as the domain and once as the public, and answers the available one with its offer", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("bookable", "room")]);
      const getBookablesByIds = bookablesAnswering({
        domain: [room({ review: { status: "approved" } })],
        public: [room()],
      });

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
        tenantId: TENANT,
      });

      expect(FavoriteManager.getFavorites.firstCall.args).to.deep.equal([
        USER,
        TENANT,
        DOMAIN,
      ]);
      expect(getBookablesByIds.callCount).to.equal(2);
      expect(getBookablesByIds.args).to.deep.include.members([
        [TENANT, ["room"], DOMAIN],
        [TENANT, ["room"], PUBLIC],
      ]);
      expect(entries).to.have.length(1);
      expect(entries[0]).to.include({
        tenantId: TENANT,
        targetType: "bookable",
        targetId: "room",
        title: "Titel room",
        tenantName: "Stadt Musterhausen",
        status: "available",
      });
      expect(entries[0]).to.not.have.property("userId");
      // The offer as the public bookable routes deliver it: media
      // addresses resolved, no review.
      expect(entries[0].offer).to.include({ id: "room", title: "Raum" });
      expect(entries[0].offer).to.have.property("imgUrl");
      expect(entries[0].offer).to.not.have.property("review");
    });

    it("answers unavailable for an offer that exists but the public does not reach, without an offer", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("bookable", "room")]);
      bookablesAnswering({ domain: [room()], public: [] });

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });

      expect(states(entries)).to.deep.equal([["room", "unavailable", false]]);
      expect(entries[0]).to.include({
        title: "Titel room",
        tenantName: "Stadt Musterhausen",
      });
    });

    it("answers deleted for an offer the domain does not find, with the snapshot", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("bookable", "gone")]);
      bookablesAnswering({ domain: [], public: [] });

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });

      expect(states(entries)).to.deep.equal([["gone", "deleted", false]]);
      expect(entries[0]).to.include({
        tenantId: TENANT,
        targetType: "bookable",
        title: "Titel gone",
        tenantName: "Stadt Musterhausen",
      });
    });

    it("answers unavailable for every offer of a tenant without a public projection: the public's 404 reaches nothing", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([
          favoriteOn("bookable", "room"),
          favoriteOn("bookable", "hall"),
        ]);
      sinon
        .stub(BookableManager, "getBookablesByIds")
        .callsFake(async (tenantId, ids, scope) => {
          if (scope.reach === "public") {
            throw new NotFoundError("tenant_not_found", { tenantId });
          }
          return [room(), room({ id: "hall", title: "Halle" })];
        });

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });

      expect(states(entries)).to.deep.equal([
        ["room", "unavailable", false],
        ["hall", "unavailable", false],
      ]);
    });

    it("lets any other error of the public's read through", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("bookable", "room")]);
      sinon
        .stub(BookableManager, "getBookablesByIds")
        .callsFake(async (tenantId, ids, scope) => {
          if (scope.reach === "public") throw new Error("connection lost");
          return [room()];
        });

      const error = await rejection(
        FavoriteService.getFavoriteOffers({ userId: USER }),
      );

      expect(error.message).to.equal("connection lost");
    });

    it("reads the events as (tenant, id) references and answers the available one as the public got it", async function () {
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("event", "E1"), favoriteOn("event", "E2")]);
      const getEventsByIds = sinon
        .stub(EventManager, "getEventsByIds")
        .callsFake(async (refs, scope) =>
          scope.reach === "public" ? [concert()] : [concert(), concert("E2")],
        );

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });

      expect(getEventsByIds.callCount).to.equal(2);
      expect(getEventsByIds.args).to.deep.include.members([
        [
          [
            { tenantId: TENANT, id: "E1" },
            { tenantId: TENANT, id: "E2" },
          ],
          DOMAIN,
        ],
        [
          [
            { tenantId: TENANT, id: "E1" },
            { tenantId: TENANT, id: "E2" },
          ],
          PUBLIC,
        ],
      ]);
      expect(states(entries)).to.deep.equal([
        ["E1", "available", true],
        ["E2", "unavailable", false],
      ]);
      expect(entries[0].offer).to.be.instanceOf(Event);
      expect(entries[0].offer.information.name).to.equal("Sommerkonzert");
    });

    it("decides through the real projection: a ticket of an event the supervised tenant has not approved is unavailable, of an approved one available", async function () {
      TenantManager.getTenant.resolves(
        new Tenant({
          id: TENANT,
          name: "Stadt Musterhausen",
          supervisionLevel: "supervised",
        }),
      );
      const ticket = () =>
        new Bookable({
          id: "tk",
          tenantId: TENANT,
          type: "ticket",
          eventId: "E1",
          title: "Ticket",
          review: { status: "approved" },
        });
      sinon
        .stub(FavoriteManager, "getFavorites")
        .resolves([favoriteOn("bookable", "tk")]);
      // The manager as it is: the records whole for the domain, through
      // `reached` for the public.
      sinon
        .stub(BookableManager, "getBookablesByIds")
        .callsFake(async (tenantId, ids, scope) =>
          scope.reach === "public" ? reached(tenantId, [ticket()]) : [ticket()],
        );
      const getEvents = sinon.stub(EventManager, "getEvents").resolves([
        new Event({
          id: "E1",
          tenantId: TENANT,
          information: { name: "Sommerkonzert" },
          review: { status: "pending" },
        }),
      ]);

      const pending = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });
      expect(states(pending)).to.deep.equal([["tk", "unavailable", false]]);
      expect(getEvents.firstCall.args).to.deep.equal([TENANT, DOMAIN]);

      getEvents.resolves([
        new Event({
          id: "E1",
          tenantId: TENANT,
          information: { name: "Sommerkonzert" },
          review: { status: "approved" },
        }),
      ]);
      const approved = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });
      expect(states(approved)).to.deep.equal([["tk", "available", true]]);
      expect(approved[0].offer).to.not.have.property("review");
    });

    it("loads per tenant and kind, keeps the order of the favorites, and lets one tenant's absence leave the other's offers alone", async function () {
      const favorites = [
        favoriteOn("bookable", "room-b", TENANT_B),
        favoriteOn("event", "E1"),
        favoriteOn("bookable", "room"),
        favoriteOn("bookable", "room"),
      ];
      sinon.stub(FavoriteManager, "getFavorites").resolves(favorites);
      const getBookablesByIds = sinon
        .stub(BookableManager, "getBookablesByIds")
        .callsFake(async (tenantId, ids, scope) => {
          if (tenantId === TENANT_B) {
            if (scope.reach === "public") {
              throw new NotFoundError("tenant_not_found", { tenantId });
            }
            return [room({ id: "room-b", tenantId: TENANT_B })];
          }
          return [room()];
        });
      const getEventsByIds = sinon
        .stub(EventManager, "getEventsByIds")
        .resolves([concert()]);

      const entries = await FavoriteService.getFavoriteOffers({
        userId: USER,
      });

      expect(states(entries)).to.deep.equal([
        ["room-b", "unavailable", false],
        ["E1", "available", true],
        ["room", "available", true],
        ["room", "available", true],
      ]);
      // Two reads per tenant and kind: tenant B's bookables, tenant A's
      // bookables (the id once), tenant A's events.
      expect(getBookablesByIds.callCount).to.equal(4);
      expect(getBookablesByIds.args.map(([t, ids]) => [t, ids])).to.deep.equal([
        [TENANT_B, ["room-b"]],
        [TENANT_B, ["room-b"]],
        [TENANT, ["room"]],
        [TENANT, ["room"]],
      ]);
      expect(getEventsByIds.callCount).to.equal(2);
    });

    it("answers an empty list without reading an offer", async function () {
      sinon.stub(FavoriteManager, "getFavorites").resolves([]);
      const getBookablesByIds = sinon.stub(
        BookableManager,
        "getBookablesByIds",
      );
      const getEventsByIds = sinon.stub(EventManager, "getEventsByIds");

      expect(
        await FavoriteService.getFavoriteOffers({ userId: USER }),
      ).to.deep.equal([]);
      expect(getBookablesByIds.called).to.equal(false);
      expect(getEventsByIds.called).to.equal(false);
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
