/**
 * The tenant approval queue (glossary "Freigabeliste der Mandanten", tenant
 * supervision spec §6.2) over an in-memory world behind the data managers:
 * the tenants at `pending`, longest waiting first, with what an instance
 * owner needs to decide.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const TenantApprovalQueueService = require("../src/commons/services/supervision/tenant-approval-queue-service");

const day = (n) => new Date(Date.UTC(2026, 8, n, 10, 0, 0));

describe("TenantApprovalQueueService.listTenantApprovalQueue", function () {
  let tenants;
  let memberships;
  let users;
  let bookables;
  let events;
  let history;

  const tenant = (overrides) => ({
    id: "t-new",
    name: "Verein",
    contactName: "Anna Admin",
    mail: "verein@example.test",
    phone: "0123",
    website: "https://verein.example.test",
    location: "Musterstadt",
    supervisionLevel: "pending",
    supervisionChangedAt: day(1),
    ...overrides,
  });
  const owner = (tenantId, userId) => ({
    tenantId,
    userId,
    owner: true,
    status: "active",
  });
  const user = (id, firstName, lastName) => ({ id, firstName, lastName });
  const historyRow = (overrides) => ({
    id: "h1",
    tenantId: "t-new",
    offerType: null,
    offerId: null,
    eventType: "tenant.created",
    occurredAt: day(1),
    actor: { type: "user", userId: "anna@example.test" },
    from: null,
    to: "pending",
    reason: null,
    origin: "api",
    ...overrides,
  });

  beforeEach(function () {
    tenants = [];
    memberships = [];
    users = [];
    bookables = [];
    events = [];
    history = [];

    // The database's part: the exact level, the order and the page.
    sinon
      .stub(TenantManager, "getTenants")
      .callsFake(
        async (scope, { supervisionLevel, sort, skip = 0, limit } = {}) => {
          const selected = tenants.filter(
            (t) => t.supervisionLevel === supervisionLevel,
          );
          if (sort) {
            expect(sort).to.deep.equal({ supervisionChangedAt: 1, id: 1 });
            selected.sort(
              (a, b) =>
                a.supervisionChangedAt - b.supervisionChangedAt ||
                (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
            );
          }
          return structuredClone(
            selected.slice(skip, limit ? skip + limit : undefined),
          );
        },
      );
    sinon
      .stub(TenantManager, "countTenants")
      .callsFake(
        async (scope, { supervisionLevel } = {}) =>
          tenants.filter((t) => t.supervisionLevel === supervisionLevel).length,
      );
    sinon
      .stub(MembershipManager, "getOwnerMembershipsByTenantID")
      .callsFake(async (tenantId) =>
        structuredClone(
          memberships.filter((m) => m.tenantId === tenantId && m.owner),
        ),
      );
    sinon
      .stub(UserManager, "getUsersById")
      .callsFake(async (ids) =>
        structuredClone(users.filter((u) => ids.includes(u.id))),
      );
    sinon
      .stub(BookableManager, "countBookables")
      .callsFake(
        async (tenantId) =>
          bookables.filter((b) => b.tenantId === tenantId).length,
      );
    sinon
      .stub(EventManager, "countEvents")
      .callsFake(
        async (tenantId) =>
          events.filter((e) => e.tenantId === tenantId).length,
      );
    sinon
      .stub(SupervisionHistoryManager, "latestTenantRow")
      .callsFake(async (tenantId) => {
        const rows = history
          .filter((row) => row.tenantId === tenantId && row.offerType === null)
          .sort((a, b) => b.occurredAt - a.occurredAt);
        return structuredClone(rows[0] ?? null);
      });
  });

  afterEach(function () {
    sinon.restore();
  });

  const list = (params = {}) =>
    TenantApprovalQueueService.listTenantApprovalQueue(params);

  it("answers a newly created tenant as one row with contact, owners, offer count and its creation as last change", async function () {
    tenants.push(tenant());
    memberships.push(owner("t-new", "anna@example.test"));
    users.push(user("anna@example.test", "Anna", "Admin"));
    bookables.push({ id: "b1", tenantId: "t-new" });
    history.push(historyRow());

    const result = await list();

    expect(result).to.deep.equal({
      items: [
        {
          tenantId: "t-new",
          tenantName: "Verein",
          waitingSince: day(1),
          contact: {
            contactName: "Anna Admin",
            mail: "verein@example.test",
            phone: "0123",
            website: "https://verein.example.test",
            location: "Musterstadt",
          },
          owners: [
            {
              userId: "anna@example.test",
              displayName: "Anna Admin",
              mail: "anna@example.test",
            },
          ],
          offerCount: 1,
          lastChange: historyRow(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
  });

  it("lists only tenants at pending: free, supervised, declined and a tenant without a stored level are never rows", async function () {
    tenants.push(
      tenant({ id: "t-free", supervisionLevel: "free" }),
      tenant({ id: "t-sup", supervisionLevel: "supervised" }),
      tenant({ id: "t-declined", supervisionLevel: "declined" }),
      tenant({ id: "t-legacy", supervisionLevel: undefined }),
      tenant({ id: "t-new" }),
    );

    const result = await list();

    expect(result.items.map((row) => row.tenantId)).to.deep.equal(["t-new"]);
    expect(result.total).to.equal(1);
    expect(TenantManager.getTenants.lastCall.args[1]).to.include({
      supervisionLevel: "pending",
    });
    expect(TenantManager.countTenants.lastCall.args[1]).to.deep.equal({
      supervisionLevel: "pending",
    });
  });

  it("answers a tenant without an owner membership with no owners, and an owner without an account by its id alone", async function () {
    tenants.push(tenant({ id: "t-orphan" }), tenant({ id: "t-new" }));
    memberships.push(owner("t-new", "gone@example.test"), {
      tenantId: "t-new",
      userId: "member@example.test",
      owner: false,
    });

    const rows = (await list()).items;
    const ownersOf = (id) => rows.find((r) => r.tenantId === id).owners;

    expect(ownersOf("t-orphan")).to.deep.equal([]);
    expect(ownersOf("t-new")).to.deep.equal([
      {
        userId: "gone@example.test",
        displayName: null,
        mail: "gone@example.test",
      },
    ]);
  });

  it("shows a tenant reset to pending by its level change with the reason, and null without any history", async function () {
    tenants.push(tenant({ id: "t-reset" }), tenant({ id: "t-bare" }));
    history.push(
      historyRow({ id: "h-created", tenantId: "t-reset", occurredAt: day(1) }),
      historyRow({
        id: "h-reset",
        tenantId: "t-reset",
        eventType: "tenant.levelChanged",
        occurredAt: day(3),
        actor: { type: "user", userId: "admin@example.test" },
        from: "supervised",
        to: "pending",
        reason: "Impressum fehlt",
      }),
      // An offer row of the tenant is newer still, but not about the tenant.
      historyRow({
        id: "h-offer",
        tenantId: "t-reset",
        offerType: "bookable",
        offerId: "b1",
        eventType: "review.submitted",
        occurredAt: day(4),
        to: "pending",
      }),
    );

    const rows = (await list()).items;

    expect(
      rows.find((r) => r.tenantId === "t-reset").lastChange,
    ).to.deep.include({
      eventType: "tenant.levelChanged",
      from: "supervised",
      to: "pending",
      reason: "Impressum fehlt",
      actor: { type: "user", userId: "admin@example.test" },
    });
    expect(rows.find((r) => r.tenantId === "t-bare").lastChange).to.equal(null);
  });

  it("counts bookables and events alike, whatever their publication wish or review status", async function () {
    tenants.push(tenant({ id: "t-new" }), tenant({ id: "t-other" }));
    bookables.push(
      { id: "b1", tenantId: "t-new", isPublic: true },
      {
        id: "b2",
        tenantId: "t-new",
        isPublic: false,
        review: { status: "rejected" },
      },
      { id: "b3", tenantId: "t-other" },
    );
    events.push(
      { id: "e1", tenantId: "t-new", isPublic: false },
      { id: "e2", tenantId: "t-new", review: { status: "approved" } },
      { id: "e3", tenantId: "t-new" },
    );

    const rows = (await list()).items;

    expect(rows.map((r) => [r.tenantId, r.offerCount])).to.deep.equal([
      ["t-new", 5],
      ["t-other", 1],
    ]);
  });

  it("sorts by waiting time with the id breaking a tie, cuts the page in the database and counts every waiting tenant", async function () {
    tenants.push(
      tenant({ id: "t-c", supervisionChangedAt: day(5) }),
      tenant({ id: "t-a", supervisionChangedAt: day(5) }),
      tenant({ id: "t-new", supervisionChangedAt: day(9) }),
      tenant({ id: "t-old", supervisionChangedAt: day(2) }),
      tenant({ id: "t-b", supervisionChangedAt: day(5) }),
    );
    const ids = (result) => result.items.map((row) => row.tenantId);

    const first = await list({ page: 1, pageSize: 2 });
    const second = await list({ page: "2", pageSize: "2" });
    const third = await list({ page: 3, pageSize: 2 });
    const beyond = await list({ page: 4, pageSize: 2 });

    expect(ids(first)).to.deep.equal(["t-old", "t-a"]);
    expect(ids(second)).to.deep.equal(["t-b", "t-c"]);
    expect(ids(third)).to.deep.equal(["t-new"]);
    expect(ids(beyond)).to.deep.equal([]);
    for (const result of [first, second, third, beyond]) {
      expect(result.total).to.equal(5);
      expect(result.pageSize).to.equal(2);
    }
    expect(second.page).to.equal(2);
    expect(first.items.map((row) => row.waitingSince)).to.deep.equal([
      day(2),
      day(5),
    ]);
  });

  it("falls back to the first page of 50 and caps the page size at 200", async function () {
    expect(await list({ page: "x", pageSize: "y" })).to.include({
      page: 1,
      pageSize: 50,
    });
    expect(await list({ page: 0, pageSize: 5000 })).to.include({
      page: 1,
      pageSize: 200,
    });
  });

  it("does not answer a failing read as an empty queue", async function () {
    tenants.push(tenant());
    EventManager.countEvents.rejects(new Error("mongo down"));

    let error = null;
    try {
      await list();
    } catch (err) {
      error = err;
    }
    expect(error?.message).to.equal("mongo down");
  });
});
