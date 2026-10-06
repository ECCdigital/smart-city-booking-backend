/**
 * The migration that renames the stored supervision level `blocked` to
 * `pending` (glossary "Freigabe ausstehend") in the four collections that
 * hold a level: tenants, the instance, the supervision history and the
 * notification outbox. A rename is no level change: no history row, no
 * outbox row, no change date - and a rerun changes nothing more.
 */

const { expect } = require("chai");

const migration = require("../migrations/scripts/24-09-2026-rename-supervision-level-blocked");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const CHANGED_AT = "2026-09-20T10:00:00.000Z";

function fixture() {
  return {
    Instance: [
      {
        _id: "instance",
        name: "Portal",
        tenantInitialSupervisionLevel: "blocked",
      },
    ],
    Tenant: [
      {
        id: "t-blocked",
        name: "Blocked",
        supervisionLevel: "blocked",
        supervisionChangedAt: CHANGED_AT,
      },
      { id: "t-free", name: "Free", supervisionLevel: "free" },
      {
        id: "t-supervised",
        name: "Supervised",
        supervisionLevel: "supervised",
      },
      { id: "t-declined", name: "Declined", supervisionLevel: "declined" },
      { id: "t-old", name: "Old" },
    ],
    SupervisionHistory: [
      {
        id: "h-1",
        tenantId: "t-blocked",
        eventType: "tenant.levelChanged",
        from: "free",
        to: "blocked",
        occurredAt: CHANGED_AT,
      },
      {
        id: "h-2",
        tenantId: "t-blocked",
        eventType: "tenant.levelChanged",
        from: "blocked",
        to: "supervised",
        occurredAt: "2026-09-21T10:00:00.000Z",
      },
      {
        id: "h-3",
        tenantId: "t-supervised",
        eventType: "review.submitted",
        from: null,
        to: "pending",
        occurredAt: CHANGED_AT,
      },
    ],
    SupervisionNotification: [
      {
        id: "n-1",
        type: "tenant.levelChanged",
        tenantId: "t-blocked",
        status: "sent",
        payload: { from: "free", to: "blocked", reason: null },
      },
      {
        id: "n-2",
        type: "tenant.levelChanged",
        tenantId: "t-blocked",
        status: "pending",
        payload: { from: "blocked", to: "supervised", reason: null },
      },
      {
        id: "n-3",
        type: "tenant.selfCreated",
        tenantId: "t-blocked",
        status: "sent",
        payload: { supervisionLevel: "blocked", creatorUserId: "u" },
      },
      {
        id: "n-4",
        type: "review.decided",
        tenantId: "t-supervised",
        status: "sent",
        payload: { from: "pending", to: "approved" },
      },
    ],
  };
}

const byId = (mongoose, model, id) =>
  mongoose.model(model).documents.find((document) => document.id === id);

describe("migration 24-09-2026-rename-supervision-level-blocked", function () {
  it("is named after its file", function () {
    expect(migration.name).to.equal(
      "24-09-2026-rename-supervision-level-blocked",
    );
  });

  it("renames the tenant level and leaves the change date alone", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);

    expect(byId(mongoose, "Tenant", "t-blocked")).to.deep.equal({
      id: "t-blocked",
      name: "Blocked",
      supervisionLevel: "pending",
      supervisionChangedAt: CHANGED_AT,
    });
  });

  it("leaves every other tenant level as it is, a missing one included", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);

    expect(byId(mongoose, "Tenant", "t-free").supervisionLevel).to.equal(
      "free",
    );
    expect(byId(mongoose, "Tenant", "t-supervised").supervisionLevel).to.equal(
      "supervised",
    );
    expect(byId(mongoose, "Tenant", "t-declined").supervisionLevel).to.equal(
      "declined",
    );
    expect(byId(mongoose, "Tenant", "t-old")).to.not.have.property(
      "supervisionLevel",
    );
  });

  it("renames the initial level of the instance", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);

    expect(
      mongoose.model("Instance").documents[0].tenantInitialSupervisionLevel,
    ).to.equal("pending");
  });

  it("renames from and to of the history rows and adds none", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);

    const rows = mongoose.model("SupervisionHistory").documents;
    expect(rows.map((row) => [row.id, row.from, row.to])).to.deep.equal([
      ["h-1", "free", "pending"],
      ["h-2", "pending", "supervised"],
      ["h-3", null, "pending"],
    ]);
    expect(rows[0].occurredAt).to.equal(CHANGED_AT);
  });

  it("renames the level fields of the outbox payloads and records no occasion", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);

    const rows = mongoose.model("SupervisionNotification").documents;
    expect(rows.map((row) => [row.id, row.status, row.payload])).to.deep.equal([
      ["n-1", "sent", { from: "free", to: "pending", reason: null }],
      ["n-2", "pending", { from: "pending", to: "supervised", reason: null }],
      ["n-3", "sent", { supervisionLevel: "pending", creatorUserId: "u" }],
      ["n-4", "sent", { from: "pending", to: "approved" }],
    ]);
  });

  it("changes nothing on a rerun", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);
    const once = mongoose.snapshot();

    await migration.up(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(once);
  });

  it("changes nothing where nothing reads blocked", async function () {
    const data = fixture();
    data.Instance[0].tenantInitialSupervisionLevel = "free";
    data.Tenant = data.Tenant.filter((tenant) => tenant.id !== "t-blocked");
    data.SupervisionHistory = [data.SupervisionHistory[2]];
    data.SupervisionNotification = [data.SupervisionNotification[3]];
    const mongoose = createFakeMongoose(data);
    const before = mongoose.snapshot();

    await migration.up(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(before);
  });

  it("has a down that does nothing", async function () {
    const mongoose = createFakeMongoose(fixture());
    await migration.up(mongoose);
    const after = mongoose.snapshot();

    await migration.down(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(after);
  });
});
