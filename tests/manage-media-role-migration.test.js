const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/26-08-2026-add-manage-media-role-group");

const ALL_ACTIONS = {
  create: true,
  readAny: true,
  readOwn: true,
  updateAny: true,
  updateOwn: true,
  deleteAny: true,
  deleteOwn: true,
};

const NO_ACTIONS = {
  create: false,
  readAny: false,
  readOwn: false,
  updateAny: false,
  updateOwn: false,
  deleteAny: false,
  deleteOwn: false,
};

describe("26-08-2026-add-manage-media-role-group migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("mirrorMediaPermissions", () => {
    it("copies all seven booleans from manageBookables", () => {
      const role = { manageBookables: { ...ALL_ACTIONS } };

      const changed = migration.mirrorMediaPermissions(role);

      assert.strictEqual(changed, true);
      assert.deepStrictEqual(role.manageMedia, ALL_ACTIONS);
    });

    it("mirrors a partially granted bookable permission verbatim", () => {
      const role = {
        manageBookables: { ...NO_ACTIONS, readOwn: true, updateOwn: true },
      };

      migration.mirrorMediaPermissions(role);

      assert.deepStrictEqual(role.manageMedia, {
        ...NO_ACTIONS,
        readOwn: true,
        updateOwn: true,
      });
    });

    it("grants nothing to a role without bookable permissions", () => {
      const role = {};

      const changed = migration.mirrorMediaPermissions(role);

      assert.strictEqual(changed, true);
      assert.deepStrictEqual(role.manageMedia, NO_ACTIONS);
    });

    it("reports no change when the mirror already matches", () => {
      const role = {
        manageBookables: { ...ALL_ACTIONS },
        manageMedia: { ...ALL_ACTIONS },
      };

      assert.strictEqual(migration.mirrorMediaPermissions(role), false);
    });
  });

  describe("addMediaInterface", () => {
    it("adds media where a bookable interface is managed", () => {
      const role = { adminInterfaces: ["rooms", "bookings"] };

      const changed = migration.addMediaInterface(role);

      assert.strictEqual(changed, true);
      assert.deepStrictEqual(role.adminInterfaces, [
        "rooms",
        "bookings",
        "media",
      ]);
    });

    it("leaves roles without a bookable interface alone", () => {
      const role = { adminInterfaces: ["bookings", "coupons"] };

      assert.strictEqual(migration.addMediaInterface(role), false);
      assert.deepStrictEqual(role.adminInterfaces, ["bookings", "coupons"]);
    });

    it("is idempotent", () => {
      const role = { adminInterfaces: ["events", "media"] };

      assert.strictEqual(migration.addMediaInterface(role), false);
      assert.deepStrictEqual(role.adminInterfaces, ["events", "media"]);
    });

    it("handles a role without any admin interfaces", () => {
      const role = {};

      assert.strictEqual(migration.addMediaInterface(role), false);
    });
  });

  describe("up", () => {
    function fakeRole(fields) {
      return {
        ...fields,
        markModified: sinon.spy(),
        save: sinon.stub().resolves(),
      };
    }

    it("mirrors permissions, adds the interface and saves only changed roles", async () => {
      const bookableEditor = fakeRole({
        manageBookables: { ...ALL_ACTIONS },
        adminInterfaces: ["rooms"],
      });
      const alreadyMigrated = fakeRole({
        manageBookables: { ...NO_ACTIONS },
        manageMedia: { ...NO_ACTIONS },
        adminInterfaces: ["bookings"],
      });

      const Role = {
        find: sinon.stub().resolves([bookableEditor, alreadyMigrated]),
      };
      const mongoose = { model: () => Role };

      await migration.up(mongoose);

      assert.deepStrictEqual(bookableEditor.manageMedia, ALL_ACTIONS);
      assert.deepStrictEqual(bookableEditor.adminInterfaces, [
        "rooms",
        "media",
      ]);
      assert.ok(bookableEditor.markModified.calledWith("manageMedia"));
      assert.ok(bookableEditor.markModified.calledWith("adminInterfaces"));
      assert.ok(bookableEditor.save.calledOnce);

      assert.ok(alreadyMigrated.save.notCalled);
    });
  });

  describe("down", () => {
    it("removes the role group and the admin interface", async () => {
      const Role = { updateMany: sinon.stub().resolves() };
      const mongoose = { model: () => Role };

      await migration.down(mongoose);

      assert.deepStrictEqual(Role.updateMany.firstCall.args, [
        {},
        {
          $unset: { manageMedia: "" },
          $pull: { adminInterfaces: "media" },
        },
      ]);
    });
  });
});
