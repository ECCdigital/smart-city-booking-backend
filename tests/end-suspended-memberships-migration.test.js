/**
 * The migration that removes the status `suspended` of a membership
 * (ECCdigital/tickets#633): every suspended membership ends as
 * „Mitgliedschaft beenden“ ends one - the membership and the user's open
 * invitations in the tenant go, the account stays - also for a user
 * already suspended at the instance, without a report and without a
 * suspension. Each tenant concerned gets one notice „Mitgliedschaften
 * beendet“ in the outbox, for its owners or, without one, for the instance
 * owners. A rerun, whole or after an abort, ends nothing twice and sends no
 * notice twice.
 *
 * The sender is stubbed at `dispatch`: what the notice says is the
 * sender's test (`supervision-notification-service.test.js`).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const migration = require("../migrations/scripts/23-10-2026-end-suspended-memberships");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const RUN = "2026-10-23T06:00:00.000Z";

function membership(tenantId, userId, status, overrides = {}) {
  return {
    tenantId,
    userId,
    status,
    source: "invite",
    owner: false,
    roles: [],
    invitations: [],
    ...overrides,
  };
}

function invitation(tenantId, token, intendedUserId) {
  return { tenantId, token, type: "single", status: "active", intendedUserId };
}

function fixture() {
  return {
    Tenant: [
      { id: "t-a", name: "Stadthalle" },
      { id: "t-b", name: "Verein" },
      { id: "t-c", name: "Bibliothek" },
    ],
    Membership: [
      membership("t-a", "olga@example.test", "active", { owner: true }),
      membership("t-a", "erika@example.test", "suspended"),
      membership("t-a", "max@example.test", "suspended"),
      membership("t-a", "anna@example.test", "active"),
      // The only owner of the tenant was suspended: nobody owns it after.
      membership("t-b", "bernd@example.test", "suspended", { owner: true }),
      membership("t-b", "kurt@example.test", "pending"),
      membership("t-c", "erika@example.test", "active"),
    ],
    User: [
      { id: "erika@example.test", firstName: "Erika", lastName: "Muster" },
      { id: "max@example.test", isSuspended: true },
      { id: "bernd@example.test", firstName: "Bernd", lastName: "Brot" },
    ],
    Invitation: [
      invitation("t-a", "tok-erika", "erika@example.test"),
      invitation("t-a", "tok-anna", "anna@example.test"),
      invitation("t-b", "tok-bernd", "bernd@example.test"),
      invitation("t-c", "tok-erika-c", "erika@example.test"),
      { ...invitation("t-a", "tok-link", null), type: "multi" },
    ],
    Report: [],
    SupervisionNotification: [],
  };
}

function world(collections = fixture()) {
  return createFakeMongoose(collections, {
    unique: { SupervisionNotification: ["dedupeKey", "id"] },
  });
}

const documents = (mongoose, model) => mongoose.model(model).documents;
const outbox = (mongoose) => documents(mongoose, "SupervisionNotification");
const memberships = (mongoose) =>
  documents(mongoose, "Membership").map(
    (m) => `${m.tenantId} ${m.userId} ${m.status}`,
  );

describe("23-10-2026-end-suspended-memberships migration", function () {
  let dispatched;
  let mongoose;

  beforeEach(function () {
    sinon.useFakeTimers({ now: new Date(RUN), toFake: ["Date"] });
    dispatched = [];
    // The sender as the outbox sees it: a row it dispatched is sent.
    sinon
      .stub(SupervisionNotificationService, "dispatch")
      .callsFake(async (id) => {
        const row = outbox(mongoose).find((r) => r.id === id);
        dispatched.push(row.tenantId);
        row.status = "sent";
        return row;
      });
  });

  afterEach(function () {
    sinon.restore();
  });

  it("ends every suspended membership and keeps every other one", async function () {
    mongoose = world();

    await migration.up(mongoose);

    expect(memberships(mongoose)).to.deep.equal([
      "t-a olga@example.test active",
      "t-a anna@example.test active",
      "t-b kurt@example.test pending",
      "t-c erika@example.test active",
    ]);
  });

  it("removes the open invitations of the ended members in that tenant only", async function () {
    mongoose = world();

    await migration.up(mongoose);

    expect(documents(mongoose, "Invitation").map((i) => i.token)).to.deep.equal(
      ["tok-anna", "tok-erika-c", "tok-link"],
    );
  });

  it("keeps the accounts as they are and creates no report and no suspension", async function () {
    mongoose = world();

    await migration.up(mongoose);

    expect(documents(mongoose, "User")).to.deep.equal(fixture().User);
    expect(documents(mongoose, "Report")).to.deep.equal([]);
  });

  it("records one notice per tenant concerned, naming the ended members, and dispatches it", async function () {
    mongoose = world();

    await migration.up(mongoose);

    const rows = outbox(mongoose);
    expect(rows.map((row) => row.tenantId)).to.deep.equal(["t-a", "t-b"]);
    expect(rows[0]).to.include({
      type: "memberships.ended",
      dedupeKey: "migration:memberships-ended:t-a",
    });
    expect(rows[0].createdAt).to.equal(RUN);
    expect(rows[0].payload).to.deep.equal({
      tenantName: "Stadthalle",
      members: [
        {
          userId: "erika@example.test",
          name: "Erika Muster",
          instanceSuspended: false,
        },
        { userId: "max@example.test", name: "", instanceSuspended: true },
      ],
      toInstanceOwners: false,
    });
    expect(dispatched).to.deep.equal(["t-a", "t-b"]);
  });

  it("addresses the notice of a tenant left without an owner to the instance owners", async function () {
    mongoose = world();

    await migration.up(mongoose);

    const row = outbox(mongoose).find((r) => r.tenantId === "t-b");
    expect(row.payload).to.deep.include({
      tenantName: "Verein",
      toInstanceOwners: true,
    });
    expect(row.payload.members.map((m) => m.userId)).to.deep.equal([
      "bernd@example.test",
    ]);
  });

  it("does nothing on a rerun", async function () {
    mongoose = world();
    await migration.up(mongoose);
    const before = mongoose.snapshot();

    await migration.up(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(before);
    expect(dispatched).to.deep.equal(["t-a", "t-b"]);
  });

  it("finishes after an abort without a second notice or a second mail", async function () {
    mongoose = world();
    const Membership = mongoose.model("Membership");
    const deleteMany = Membership.deleteMany;
    let calls = 0;
    Membership.deleteMany = async (filter) => {
      calls += 1;
      if (calls === 2) throw new Error("connection lost");
      return deleteMany(filter);
    };

    let error = null;
    try {
      await migration.up(mongoose);
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.equal("connection lost");

    await migration.up(mongoose);

    expect(memberships(mongoose)).to.deep.equal([
      "t-a olga@example.test active",
      "t-a anna@example.test active",
      "t-b kurt@example.test pending",
      "t-c erika@example.test active",
    ]);
    expect(outbox(mongoose).map((row) => row.tenantId)).to.deep.equal([
      "t-a",
      "t-b",
    ]);
    expect(dispatched).to.deep.equal(["t-a", "t-b"]);
  });

  it("dispatches a notice left pending by an abort, but never one already sent", async function () {
    mongoose = world();
    SupervisionNotificationService.dispatch
      .onFirstCall()
      .rejects(new Error("x"));

    let error = null;
    try {
      await migration.up(mongoose);
    } catch (caught) {
      error = caught;
    }

    await migration.up(mongoose);

    expect(error?.message).to.equal("x");
    expect(outbox(mongoose).map((row) => row.status)).to.deep.equal([
      "sent",
      "sent",
    ]);
    expect(dispatched).to.deep.equal(["t-a", "t-b"]);
  });
});
