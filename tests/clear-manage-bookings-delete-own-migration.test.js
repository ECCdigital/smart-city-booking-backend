const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/23-11-2026-clear-manage-bookings-delete-own");

describe("23-11-2026-clear-manage-bookings-delete-own migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  function fakeMongoose(Role) {
    return { model: (name) => ({ Role })[name] };
  }

  it("clears manageBookings.deleteOwn on every role that holds it, and nothing else", async () => {
    const Role = {
      updateMany: sinon.stub().resolves({ modifiedCount: 2 }),
    };

    await migration.up(fakeMongoose(Role));

    assert.strictEqual(Role.updateMany.callCount, 1);
    assert.deepStrictEqual(Role.updateMany.firstCall.args, [
      { "manageBookings.deleteOwn": true },
      { $set: { "manageBookings.deleteOwn": false } },
    ]);
  });

  it("writes nothing on down: which roles held the level is not kept", async () => {
    const Role = { updateMany: sinon.stub() };

    await migration.down(fakeMongoose(Role));

    assert.strictEqual(Role.updateMany.callCount, 0);
  });
});
