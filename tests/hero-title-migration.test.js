/**
 * The migration that turns the old Hero title into the Portal Name
 * (hero-layout ticket 06): `hero.title` is copied into an empty `name` of the
 * instance catalog, then `hero` is unset on every catalog. Runs over a
 * stubbed model, no database.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const migration = require("../migrations/scripts/10-09-2026-hero-title-to-portal-name");

describe("10-09-2026-hero-title-to-portal-name migration", function () {
  afterEach(function () {
    sinon.restore();
  });

  /** A Catalog model whose instance catalog reads as `instance`. */
  function catalogModel(instance) {
    return {
      findOne: sinon.stub().returns({ lean: async () => instance }),
      updateOne: sinon.stub().resolves({ modifiedCount: 1 }),
      updateMany: sinon.stub().resolves({ modifiedCount: 1 }),
    };
  }

  const fakeMongoose = (Catalog) => ({ model: (name) => ({ Catalog })[name] });

  describe("up", function () {
    it("copies hero.title into an empty name and unsets hero everywhere", async function () {
      const Catalog = catalogModel({
        _id: "instance-1",
        type: "instance",
        name: "",
        hero: { title: "Willkommen", subtitle: "Buchen Sie online" },
      });

      await migration.up(fakeMongoose(Catalog));

      expect(Catalog.findOne.firstCall.args[0]).to.deep.equal({
        type: "instance",
      });
      expect(Catalog.updateOne.firstCall.args).to.deep.equal([
        { _id: "instance-1" },
        { $set: { name: "Willkommen" } },
      ]);
      expect(Catalog.updateMany.firstCall.args).to.deep.equal([
        { hero: { $exists: true } },
        { $unset: { hero: "" } },
        { strict: false },
      ]);
    });

    it("copies into a name that is missing altogether", async function () {
      const Catalog = catalogModel({
        _id: "instance-1",
        type: "instance",
        hero: { title: "Willkommen", subtitle: "" },
      });

      await migration.up(fakeMongoose(Catalog));

      expect(Catalog.updateOne.firstCall.args[1]).to.deep.equal({
        $set: { name: "Willkommen" },
      });
    });

    it("keeps a Portal Name that is already set", async function () {
      const Catalog = catalogModel({
        _id: "instance-1",
        type: "instance",
        name: "Stadt Musterstadt",
        hero: { title: "Willkommen", subtitle: "" },
      });

      await migration.up(fakeMongoose(Catalog));

      expect(Catalog.updateOne.called).to.equal(false);
      expect(Catalog.updateMany.calledOnce).to.equal(true);
    });

    it("copies nothing from an empty or blank title", async function () {
      for (const hero of [{ title: "" }, { title: "   " }, {}, undefined]) {
        const Catalog = catalogModel({
          _id: "instance-1",
          type: "instance",
          name: "",
          hero,
        });

        await migration.up(fakeMongoose(Catalog));

        expect(Catalog.updateOne.called).to.equal(false);
      }
    });

    it("is a no-op the second time", async function () {
      // After the first run: the name is set and no catalog carries hero.
      const Catalog = catalogModel({
        _id: "instance-1",
        type: "instance",
        name: "Willkommen",
      });

      await migration.up(fakeMongoose(Catalog));

      expect(Catalog.updateOne.called).to.equal(false);
      // The unset targets only catalogs that still carry the key, so it
      // touches nothing now.
      expect(Catalog.updateMany.firstCall.args[0]).to.deep.equal({
        hero: { $exists: true },
      });
    });

    it("still unsets hero on the tenant catalogs without an instance catalog", async function () {
      const Catalog = catalogModel(null);

      await migration.up(fakeMongoose(Catalog));

      expect(Catalog.updateOne.called).to.equal(false);
      expect(Catalog.updateMany.calledOnce).to.equal(true);
    });
  });

  describe("down", function () {
    it("puts the Portal Name back as the hero title of the instance catalog", async function () {
      const Catalog = catalogModel({
        _id: "instance-1",
        type: "instance",
        name: "Willkommen",
      });

      await migration.down(fakeMongoose(Catalog));

      expect(Catalog.updateOne.firstCall.args).to.deep.equal([
        { _id: "instance-1" },
        { $set: { hero: { title: "Willkommen", subtitle: "" } } },
        { strict: false },
      ]);
    });

    it("does nothing without an instance catalog", async function () {
      const Catalog = catalogModel(null);

      await migration.down(fakeMongoose(Catalog));

      expect(Catalog.updateOne.called).to.equal(false);
    });
  });

  it("is named after its file", function () {
    expect(migration.name).to.equal("10-09-2026-hero-title-to-portal-name");
  });
});
