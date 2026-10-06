/**
 * The creation service under contention: parallel self-creations of one
 * user cannot exceed the limit, because the limiter's store counts a
 * reservation before the creation writes. The store is an in-memory fake
 * of `RateLimitEventManager` that answers like the collection would across
 * processes; every other manager is stubbed.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const TenantCreationService = require("../src/commons/services/tenant/tenant-creation-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const RateLimitEventManager = require("../src/commons/data-managers/rate-limit-event-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const { User } = require("../src/commons/entities/user/user");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");
const { instance: mailInstance } = require("./helpers/mail-stack-fixtures");
const {
  TooManyRequestsError,
  ConflictError,
  ForbiddenError,
} = require("../src/errors/BaseError");

const USER = "raumgeber@example.test";
const VALID = Object.freeze({
  name: "Werkstatt",
  contactName: "Max Muster",
  mail: "werkstatt@example.test",
});

/** The rejection of a promise, or a failure when it fulfilled. */
async function rejects(promise, ErrorClass) {
  try {
    await promise;
  } catch (error) {
    expect(error).to.be.instanceOf(ErrorClass);
    return error;
  }
  throw new Error("expected the promise to reject");
}

/** The rows of the limiter's collection, with the writes of every process. */
function inMemoryRateLimitStore() {
  const rows = new Map();
  let nextId = 1;
  sinon.stub(RateLimitEventManager, "record").callsFake(async (key, at) => {
    const id = String(nextId++);
    rows.set(id, { key, at });
    return id;
  });
  sinon
    .stub(RateLimitEventManager, "countSince")
    .callsFake(
      async (key, since) =>
        [...rows.values()].filter((r) => r.key === key && r.at > since).length,
    );
  sinon
    .stub(RateLimitEventManager, "oldestAtWithin")
    .callsFake(async (key, since, skip = 0) => {
      const ats = [...rows.values()]
        .filter((r) => r.key === key && r.at > since)
        .map((r) => r.at)
        .sort((a, b) => a - b);
      return ats[skip] ?? null;
    });
  sinon.stub(RateLimitEventManager, "remove").callsFake(async (id) => {
    rows.delete(id);
  });
  return rows;
}

describe("TenantCreationService under contention", function () {
  let tenants;
  let memberships;

  beforeEach(function () {
    tenants = new Map();
    memberships = new Map();
    sinon.stub(TenantManager, "checkTenantCount").resolves(true);
    sinon.stub(TenantManager, "checkTenantCountAfterInsert").resolves(true);
    sinon.stub(TenantManager, "storeTenant").callsFake(async (tenant) => {
      // Slow enough that the four creations below overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      tenants.set(tenant.id, tenant);
      return tenant;
    });
    sinon.stub(TenantManager, "removeTenant").callsFake(async (id) => {
      tenants.delete(id);
    });
    sinon
      .stub(MembershipManager, "addMembership")
      .callsFake(async (tenantId, membership) => {
        memberships.set(tenantId, membership);
        return membership;
      });
    sinon
      .stub(MembershipManager, "removeMembership")
      .callsFake(async (tenantId) => {
        memberships.delete(tenantId);
      });
    sinon.stub(InstanceManager, "getInstance").resolves({
      tenantInitialSupervisionLevel: "free",
    });
    sinon
      .stub(UserManager, "getUser")
      .callsFake(async (id) => new User({ id, isVerified: true }));
    sinon.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
    sinon.stub(SupervisionHistoryManager, "insert").resolves({});
    sinon.stub(SupervisionNotificationManager, "record").resolves({});
  });

  afterEach(function () {
    sinon.restore();
  });

  const createAs = (userId) =>
    TenantCreationService.create({
      body: VALID,
      creatorUserId: userId,
      creatorIsInstanceOwner: false,
      reaches: { "media.read": "own", userId },
    });

  it("never lets more than three of a burst of parallel self-creations through", async function () {
    const rows = inMemoryRateLimitStore();

    // The limiter reserves before it counts, so a burst can be denied
    // beyond the limit but never admitted beyond it (ticket 02); what a
    // denial does not spend, the next attempt gets.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createAs(USER)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).to.be.at.most(3);
    expect(rejected.length).to.equal(6 - fulfilled.length);
    for (const { reason } of rejected) {
      expect(reason).to.be.instanceOf(TooManyRequestsError);
      expect(reason.params.retryAfterSeconds).to.be.at.least(1);
    }
    expect(tenants.size).to.equal(fulfilled.length);
    expect(memberships.size).to.equal(fulfilled.length);
    expect(rows.size).to.equal(fulfilled.length);

    // One at a time, the remaining slots of the window are still there.
    for (let i = fulfilled.length; i < 3; i += 1) await createAs(USER);
    expect(tenants.size).to.equal(3);
    await rejects(createAs(USER), TooManyRequestsError);
  });

  it("a self-creation mails every instance owner and confirms the actual initial level to the creator", async function () {
    inMemoryRateLimitStore();
    InstanceManager.getInstance.restore();
    sinon.stub(InstanceManager, "getInstance").resolves(
      mailInstance({
        tenantInitialSupervisionLevel: "supervised",
        ownerUserIds: ["anna@plattform.example.test"],
      }),
    );
    sinon
      .stub(UserManager, "getUsersById")
      .callsFake(async (ids) => ids.map((id) => ({ id })));
    const sent = installInMemoryMailTransport();
    const outbox = installSupervisionOutboxStore();

    await createAs(USER);
    await SupervisionNotificationService.whenIdle();

    expect(sent.map((mail) => mail.to)).to.deep.equal([
      "anna@plattform.example.test",
      USER,
    ]);
    expect(sent[1].html).to.include("beaufsichtigt");
    expect(outbox.map((row) => row.status)).to.deep.equal(["sent"]);
  });

  it("frees the slot of a failed creation for the next attempt and leaves nothing behind", async function () {
    const rows = inMemoryRateLimitStore();
    await createAs(USER);
    await createAs(USER);
    MembershipManager.addMembership.onCall(2).rejects(new Error("down"));

    const error = await rejects(createAs(USER), Error);
    expect(error.message).to.equal("down");

    expect(rows.size).to.equal(2);
    expect(tenants.size).to.equal(2);
    expect(memberships.size).to.equal(2);
    expect(SupervisionHistoryManager.insert.callCount).to.equal(2);

    // The freed slot: the third successful creation goes through, the
    // fourth does not.
    await createAs(USER);
    await rejects(createAs(USER), TooManyRequestsError);
  });

  it("keeps the created tenant when the outbox is down: the occasion never undoes the creation", async function () {
    const rows = inMemoryRateLimitStore();
    SupervisionNotificationManager.record.rejects(new Error("outbox down"));

    const tenant = await createAs(USER);

    expect(tenants.has(tenant.id)).to.be.true;
    expect(memberships.has(tenant.id)).to.be.true;
    expect(rows.size).to.equal(1);
    expect(TenantManager.removeTenant.called).to.be.false;
  });

  it("answers the original failure and frees the slot even when the rollback fails too", async function () {
    const rows = inMemoryRateLimitStore();
    MembershipManager.addMembership.rejects(new Error("down"));
    TenantManager.removeTenant.rejects(new Error("rollback down"));

    const error = await rejects(createAs(USER), Error);

    expect(error.message).to.equal("down");
    expect(rows.size).to.equal(0);
  });

  it("takes a creation back that overshot MAX_TENANTS in a race", async function () {
    const rows = inMemoryRateLimitStore();
    TenantManager.checkTenantCountAfterInsert.resolves(false);

    const error = await rejects(createAs(USER), ConflictError);

    expect(error.code).to.equal("max_tenants_reached");
    expect(tenants.size).to.equal(0);
    expect(memberships.size).to.equal(0);
    expect(rows.size).to.equal(0);
    expect(SupervisionHistoryManager.insert.called).to.be.false;
  });

  it("stores the contact trimmed", async function () {
    inMemoryRateLimitStore();

    const tenant = await TenantCreationService.create({
      body: {
        name: " Werkstatt ",
        contactName: " Max ",
        mail: " w@example.test ",
      },
      creatorUserId: USER,
      creatorIsInstanceOwner: false,
      reaches: { "media.read": "own", userId: USER },
    });

    expect(tenant).to.include({
      name: "Werkstatt",
      contactName: "Max",
      mail: "w@example.test",
    });
  });

  it("takes the proof of the creator's own account only", async function () {
    inMemoryRateLimitStore();
    // The user lookup matches loosely; a verified look-alike is no proof.
    UserManager.getUser.resolves(
      new User({ id: `x${USER}`, isVerified: true }),
    );

    const error = await rejects(createAs(USER), ForbiddenError);

    expect(error.code).to.equal("email_verification_required");
    expect(tenants.size).to.equal(0);
  });

  it("counts every user on their own", async function () {
    inMemoryRateLimitStore();
    for (let i = 0; i < 3; i += 1) await createAs(USER);

    await rejects(createAs(USER), TooManyRequestsError);
    await createAs("andere@example.test");
    expect(tenants.size).to.equal(4);
  });
});
