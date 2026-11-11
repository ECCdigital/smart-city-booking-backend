const assert = require("assert");
const sinon = require("sinon");

const LockerSystemHoldManager = require("../src/commons/data-managers/locker-system-hold-manager");
const LockerSystemHoldModel = require("../src/commons/data-managers/models/lockerSystemHoldModel");

const NOW = new Date("2026-11-11T10:00:00Z");
const ACQUIRE = { holder: "holder-1", now: NOW, ttlMs: 15000 };

describe("LockerSystemHoldManager.acquire", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("takes the hold when the upsert goes through", async function () {
    sinon.stub(LockerSystemHoldModel, "updateOne").resolves({});

    assert.strictEqual(
      await LockerSystemHoldManager.acquire("tenant-1:ls-1", ACQUIRE),
      true,
    );
  });

  it("answers held when the unique key refuses the upsert", async function () {
    const duplicate = new Error("E11000 duplicate key error");
    duplicate.code = 11000;
    sinon.stub(LockerSystemHoldModel, "updateOne").rejects(duplicate);

    assert.strictEqual(
      await LockerSystemHoldManager.acquire("tenant-1:ls-1", ACQUIRE),
      false,
    );
  });

  it("passes any other failure of the store on", async function () {
    sinon
      .stub(LockerSystemHoldModel, "updateOne")
      .rejects(new Error("connection reset"));

    await assert.rejects(
      LockerSystemHoldManager.acquire("tenant-1:ls-1", ACQUIRE),
      { message: "connection reset" },
    );
  });
});
