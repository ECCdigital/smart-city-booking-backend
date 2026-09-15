const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/25-08-2026-customfield-show-in-mail");

describe("25-08-2026-customfield-show-in-mail migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("migrateDefinitions", () => {
    it("backfills showInMail: false where the flag is missing", () => {
      const definitions = [
        { id: "a", usageOptions: { context: "checkout" } },
        { id: "b", usageOptions: { context: "catalog" } },
      ];

      const changed = migration.migrateDefinitions(definitions);

      assert.strictEqual(changed, true);
      assert.strictEqual(definitions[0].usageOptions.showInMail, false);
      assert.strictEqual(definitions[1].usageOptions.showInMail, false);
    });

    it("creates usageOptions when it is missing entirely", () => {
      const definitions = [{ id: "a" }];

      const changed = migration.migrateDefinitions(definitions);

      assert.strictEqual(changed, true);
      assert.strictEqual(definitions[0].usageOptions.showInMail, false);
    });

    it("does not overwrite an existing showInMail value", () => {
      const definitions = [
        { id: "a", usageOptions: { context: "checkout", showInMail: true } },
        { id: "b", usageOptions: { context: "checkout", showInMail: false } },
      ];

      const changed = migration.migrateDefinitions(definitions);

      assert.strictEqual(changed, false);
      assert.strictEqual(definitions[0].usageOptions.showInMail, true);
      assert.strictEqual(definitions[1].usageOptions.showInMail, false);
    });

    it("handles undefined and empty definition lists", () => {
      assert.strictEqual(migration.migrateDefinitions(undefined), false);
      assert.strictEqual(migration.migrateDefinitions([]), false);
    });
  });

  describe("up", () => {
    function fakeDoc(fieldName, definitions) {
      return {
        [fieldName]: definitions,
        markModified: sinon.spy(),
        save: sinon.stub().resolves(),
      };
    }

    it("backfills instance, tenant and bookable definitions and saves only changed docs", async () => {
      const instance = fakeDoc("bookableCustomFields", [
        { id: "i1", usageOptions: { context: "checkout" } },
      ]);
      const tenantChanged = fakeDoc("bookableCustomFields", [
        { id: "t1", usageOptions: {} },
      ]);
      const tenantUnchanged = fakeDoc("bookableCustomFields", [
        { id: "t2", usageOptions: { showInMail: true } },
      ]);
      const bookable = fakeDoc("customFieldDefinitions", [{ id: "b1" }]);

      const models = {
        Instance: { find: sinon.stub().resolves([instance]) },
        Tenant: {
          find: sinon.stub().resolves([tenantChanged, tenantUnchanged]),
        },
        Bookable: { find: sinon.stub().resolves([bookable]) },
      };
      const mongoose = { model: (name) => models[name] };

      await migration.up(mongoose);

      assert.strictEqual(
        instance.bookableCustomFields[0].usageOptions.showInMail,
        false,
      );
      assert.ok(instance.markModified.calledWith("bookableCustomFields"));
      assert.ok(instance.save.calledOnce);

      assert.strictEqual(
        tenantChanged.bookableCustomFields[0].usageOptions.showInMail,
        false,
      );
      assert.ok(tenantChanged.save.calledOnce);

      assert.strictEqual(
        tenantUnchanged.bookableCustomFields[0].usageOptions.showInMail,
        true,
      );
      assert.ok(tenantUnchanged.save.notCalled);

      assert.strictEqual(
        bookable.customFieldDefinitions[0].usageOptions.showInMail,
        false,
      );
      assert.ok(bookable.markModified.calledWith("customFieldDefinitions"));
      assert.ok(bookable.save.calledOnce);
    });
  });

  describe("down", () => {
    it("unsets showInMail on all three levels", async () => {
      const models = {
        Instance: { updateMany: sinon.stub().resolves() },
        Tenant: { updateMany: sinon.stub().resolves() },
        Bookable: { updateMany: sinon.stub().resolves() },
      };
      const mongoose = { model: (name) => models[name] };

      await migration.down(mongoose);

      assert.deepStrictEqual(models.Instance.updateMany.firstCall.args, [
        {},
        {
          $unset: {
            "bookableCustomFields.$[].usageOptions.showInMail": "",
          },
        },
      ]);
      assert.deepStrictEqual(models.Tenant.updateMany.firstCall.args, [
        {},
        {
          $unset: {
            "bookableCustomFields.$[].usageOptions.showInMail": "",
          },
        },
      ]);
      assert.deepStrictEqual(models.Bookable.updateMany.firstCall.args, [
        {},
        {
          $unset: {
            "customFieldDefinitions.$[].usageOptions.showInMail": "",
          },
        },
      ]);
    });
  });
});
