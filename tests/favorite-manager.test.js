/**
 * The favorite manager (glossary "Favorit"): every read names the user and
 * takes a reach, the store finds the entry a user already set on the same
 * target instead of inserting a second one, a remove of nothing is nothing,
 * and the user lifecycle moves or removes the favorites of a user.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const FavoriteManager = require("../src/commons/data-managers/favorite-manager");
const FavoriteModel = require("../src/commons/data-managers/models/favoriteModel");
const { Favorite } = require("../src/commons/entities/favorite/favorite");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const USER = "erika@example.test";
const KEY = {
  userId: USER,
  tenantId: "tenant-1",
  targetType: "bookable",
  targetId: "room",
};

function favorite(overrides = {}) {
  return Favorite.create({
    ...KEY,
    title: "Raum",
    tenantName: "Stadt Musterhausen",
    created: new Date("2026-10-01T08:00:00.000Z"),
    ...overrides,
  });
}

const fakeDocument = (entity) => ({ toEntity: () => entity });

/** A `find` whose `sort` answers the documents. */
const sorted = (docs) => ({ sort: async () => docs });

describe("FavoriteManager", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("getFavorites", function () {
    it("reads the favorites of the user across tenants, newest first", async function () {
      const find = sinon.stub(FavoriteModel, "find").returns(sorted([]));

      await FavoriteManager.getFavorites(USER, null, DOMAIN);

      expect(find.calledOnceWithExactly({ userId: USER })).to.equal(true);
    });

    it("narrows to one tenant when asked", async function () {
      const find = sinon.stub(FavoriteModel, "find").returns(sorted([]));

      await FavoriteManager.getFavorites(USER, "tenant-1", DOMAIN);

      expect(
        find.calledOnceWithExactly({ userId: USER, tenantId: "tenant-1" }),
      ).to.equal(true);
    });

    it("answers entities", async function () {
      const expected = favorite();
      sinon
        .stub(FavoriteModel, "find")
        .returns(sorted([fakeDocument(expected)]));

      const favorites = await FavoriteManager.getFavorites(USER, null, DOMAIN);

      expect(favorites).to.deep.equal([expected]);
    });

    it("refuses a read without a reach", async function () {
      sinon.stub(FavoriteModel, "find").returns(sorted([]));
      let error = null;
      try {
        await FavoriteManager.getFavorites(USER, null);
      } catch (err) {
        error = err;
      }
      expect(error?.message).to.match(/without a reach/);
    });
  });

  describe("getFavorite", function () {
    it("reads by the four keys", async function () {
      const findOne = sinon.stub(FavoriteModel, "findOne").resolves(null);

      const found = await FavoriteManager.getFavorite(
        USER,
        "tenant-1",
        "bookable",
        "room",
        DOMAIN,
      );

      expect(found).to.equal(null);
      expect(findOne.calledOnceWithExactly(KEY)).to.equal(true);
    });

    it("refuses a read without a reach", async function () {
      sinon.stub(FavoriteModel, "findOne").resolves(null);
      let error = null;
      try {
        await FavoriteManager.getFavorite(USER, "tenant-1", "bookable", "room");
      } catch (err) {
        error = err;
      }
      expect(error?.message).to.match(/without a reach/);
    });
  });

  describe("countFavorites", function () {
    it("counts the favorites of the user", async function () {
      const count = sinon.stub(FavoriteModel, "countDocuments").resolves(3);

      expect(await FavoriteManager.countFavorites(USER)).to.equal(3);
      expect(count.calledOnceWithExactly({ userId: USER })).to.equal(true);
    });
  });

  describe("storeFavorite", function () {
    it("upserts over the four keys and sets the snapshot only on insert", async function () {
      const entity = favorite();
      const update = sinon
        .stub(FavoriteModel, "findOneAndUpdate")
        .resolves(fakeDocument(entity));

      const stored = await FavoriteManager.storeFavorite(entity);

      expect(stored).to.equal(entity);
      const [filter, change, options] = update.firstCall.args;
      expect(filter).to.deep.equal(KEY);
      expect(change).to.deep.equal({
        $setOnInsert: {
          ...KEY,
          title: "Raum",
          tenantName: "Stadt Musterhausen",
          created: new Date("2026-10-01T08:00:00.000Z"),
        },
      });
      expect(options).to.deep.equal({ upsert: true, new: true });
    });

    it("validates the favorite before it writes", async function () {
      const update = sinon.stub(FavoriteModel, "findOneAndUpdate");
      let error = null;
      try {
        await FavoriteManager.storeFavorite({ ...KEY, targetType: "ticket" });
      } catch (err) {
        error = err;
      }
      expect(error).to.not.equal(null);
      expect(update.called).to.equal(false);
    });
  });

  describe("removeFavorite", function () {
    it("deletes by the four keys, and is fine with nothing to delete", async function () {
      const deleteOne = sinon
        .stub(FavoriteModel, "deleteOne")
        .resolves({ deletedCount: 0 });

      await FavoriteManager.removeFavorite(
        USER,
        "tenant-1",
        "bookable",
        "room",
      );

      expect(deleteOne.calledOnceWithExactly(KEY)).to.equal(true);
    });
  });

  describe("the user lifecycle", function () {
    it("moves the favorites of a user to the new id, in the session it is given", async function () {
      const updateMany = sinon.stub(FavoriteModel, "updateMany").resolves();
      const session = { id: "s1" };

      await FavoriteManager.reassignUserId(USER, "neu@example.test", session);

      expect(
        updateMany.calledOnceWithExactly(
          { userId: USER },
          { $set: { userId: "neu@example.test" } },
          { session },
        ),
      ).to.equal(true);
    });

    it("moves without a session where there is none", async function () {
      const updateMany = sinon.stub(FavoriteModel, "updateMany").resolves();

      await FavoriteManager.reassignUserId(USER, "neu@example.test");

      expect(updateMany.firstCall.args[2]).to.deep.equal({});
    });

    it("removes every favorite of a user", async function () {
      const deleteMany = sinon.stub(FavoriteModel, "deleteMany").resolves();

      await FavoriteManager.removeFavoritesOfUser(USER);

      expect(deleteMany.calledOnceWithExactly({ userId: USER })).to.equal(true);
    });
  });
});
