/**
 * The tickets of an event are read by `{tenantId, eventId, type}`: the
 * bookables carry an index with exactly these keys, the queries for the
 * tickets of an event set its keys by equality, and a migration builds it
 * on existing instances, again or on a database without bookables without
 * harm.
 */

const path = require("path");
const { expect } = require("chai");
const sinon = require("sinon");

const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const MIGRATION_FILE = "18-11-2026-add-bookable-event-index.js";
const migration = require(
  path.join(__dirname, "../migrations/scripts", MIGRATION_FILE),
);

const KEYS = { tenantId: 1, eventId: 1, type: 1 };
const NAME = "tenantId_1_eventId_1_type_1";
const ID_INDEX = { name: "_id_", key: { _id: 1 } };
const TENANT_ID_INDEX = {
  name: "tenantId_1_id_1",
  key: { tenantId: 1, id: 1 },
};

/** A `bookables` collection with these indexes, or none at all. */
function fakeConnection(indexes) {
  const state = { indexes: indexes && [...indexes], created: [], dropped: [] };
  const collection = {
    async indexes() {
      if (!state.indexes) {
        const error = new Error("ns does not exist");
        error.code = 26;
        error.codeName = "NamespaceNotFound";
        throw error;
      }
      return state.indexes;
    },
    async createIndex(keys, options) {
      state.created.push([keys, options]);
      state.indexes = [...(state.indexes || []), { key: keys, ...options }];
      return options.name;
    },
    async dropIndex(name) {
      state.dropped.push(name);
      state.indexes = state.indexes.filter((index) => index.name !== name);
    },
  };
  return {
    state,
    connection: {
      model: (name) => (name === "Bookable" ? { collection } : undefined),
    },
  };
}

/** A filter value matched by equality, not an operator like `$in`. */
const isEquality = (value) =>
  !(
    value &&
    typeof value === "object" &&
    Object.keys(value).some((key) => key.startsWith("$"))
  );

describe("bookable index for the tickets of an event", function () {
  describe("the bookable model", function () {
    it("has the index on tenantId, eventId and type in this order", function () {
      const index = BookableModel.schema
        .indexes()
        .find(([, options]) => options?.name === NAME);

      expect(index, "named index exists").to.exist;
      expect(Object.keys(index[0])).to.deep.equal(Object.keys(KEYS));
      expect(index[0]).to.deep.equal(KEYS);
    });

    it("keeps the index on tenantId and id", function () {
      const fields = BookableModel.schema.indexes().map(([keys]) => keys);

      expect(fields).to.deep.include({ tenantId: 1, id: 1 });
    });
  });

  describe("the queries for the tickets of an event", function () {
    let find;

    beforeEach(function () {
      find = sinon.stub(BookableModel, "find").resolves([]);
    });

    afterEach(function () {
      sinon.restore();
    });

    it("BookingManager.getEventBookings sets every key of the index by equality", async function () {
      sinon.stub(BookingManager, "getRelatedBookingsBatch").resolves([]);

      await BookingManager.getEventBookings("t1", "e1", DOMAIN);

      const filter = find.firstCall.args[0];
      expect(filter).to.include({
        tenantId: "t1",
        eventId: "e1",
        type: "ticket",
      });
      for (const key of Object.keys(KEYS)) {
        expect(isEquality(filter[key]), key).to.equal(true);
      }
    });

    it("BookableManager.getEventBookables sets the first two keys by equality", async function () {
      await BookableManager.getEventBookables("t1", "e1", DOMAIN);

      const filter = find.firstCall.args[0];
      expect(filter).to.include({ tenantId: "t1", eventId: "e1" });
    });
  });

  describe("the migration", function () {
    it("is named after its file, as DD-MM-YYYY-…", function () {
      expect(migration.name).to.equal(MIGRATION_FILE.replace(/\.js$/, ""));
      expect(migration.name).to.match(/^\d{2}-\d{2}-\d{4}-/);
    });

    it("builds the index once", async function () {
      const { state, connection } = fakeConnection([ID_INDEX, TENANT_ID_INDEX]);

      await migration.up(connection);

      expect(state.created).to.deep.equal([[KEYS, { name: NAME }]]);
    });

    it("builds nothing where an index with these keys stands, whatever its name", async function () {
      const { state, connection } = fakeConnection([
        ID_INDEX,
        TENANT_ID_INDEX,
        { name: "by_hand", key: { ...KEYS } },
      ]);

      await migration.up(connection);
      await migration.up(connection);

      expect(state.created).to.deep.equal([]);
    });

    it("builds nothing on a second run", async function () {
      const { state, connection } = fakeConnection([ID_INDEX, TENANT_ID_INDEX]);

      await migration.up(connection);
      await migration.up(connection);

      expect(state.created).to.have.length(1);
    });

    it("builds the index on a database without bookables", async function () {
      const { state, connection } = fakeConnection(null);

      await migration.up(connection);

      expect(state.created).to.deep.equal([[KEYS, { name: NAME }]]);
    });

    it("drops the index with these keys by its name on the way down", async function () {
      const { state, connection } = fakeConnection([
        ID_INDEX,
        TENANT_ID_INDEX,
        { name: "by_hand", key: { ...KEYS } },
      ]);

      await migration.down(connection);

      expect(state.dropped).to.deep.equal(["by_hand"]);
    });

    it("drops nothing on the way down where the index is missing", async function () {
      const { state, connection } = fakeConnection([ID_INDEX, TENANT_ID_INDEX]);

      await migration.down(connection);

      expect(state.dropped).to.deep.equal([]);
    });

    it("drops nothing on the way down on a database without bookables", async function () {
      const { state, connection } = fakeConnection(null);

      await migration.down(connection);

      expect(state.dropped).to.deep.equal([]);
    });
  });
});
