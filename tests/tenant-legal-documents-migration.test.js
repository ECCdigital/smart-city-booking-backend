const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/28-08-2026-add-tenant-legal-documents");

describe("28-08-2026-add-tenant-legal-documents migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  function fakeMongoose(Tenant) {
    return { model: (name) => ({ Tenant })[name] };
  }

  describe("up", () => {
    it("sets an empty list only where the field is missing", async () => {
      const Tenant = {
        updateMany: sinon.stub().resolves({ modifiedCount: 2 }),
      };

      await migration.up(fakeMongoose(Tenant));

      assert.deepStrictEqual(Tenant.updateMany.firstCall.args, [
        { legalDocuments: { $exists: false } },
        { $set: { legalDocuments: [] } },
      ]);
    });
  });

  describe("down", () => {
    it("unsets the field on every tenant", async () => {
      const Tenant = {
        updateMany: sinon.stub().resolves({ modifiedCount: 2 }),
      };

      await migration.down(fakeMongoose(Tenant));

      assert.deepStrictEqual(Tenant.updateMany.firstCall.args, [
        {},
        { $unset: { legalDocuments: "" } },
      ]);
    });
  });

  it("is named after its file", () => {
    assert.strictEqual(migration.name, "28-08-2026-add-tenant-legal-documents");
  });
});
