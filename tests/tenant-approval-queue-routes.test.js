/**
 * `GET /api/instances/tenant-approval-queue` (tenant supervision spec §6.2)
 * over the lifecycle harness: the instance owner alone reads the tenant
 * approval queue (glossary "Freigabeliste der Mandanten"), paginated.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");

const WAITING_SINCE = "2026-09-01T10:00:00.000Z";

describe("GET /api/instances/tenant-approval-queue", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    TenantManager.getTenants.callsFake(async () => [
      {
        id: TENANT,
        name: "Verein",
        contactName: "Anna Admin",
        mail: "verein@example.test",
        phone: "0123",
        website: "https://verein.example.test",
        location: "Musterstadt",
        supervisionLevel: "pending",
        supervisionChangedAt: new Date(WAITING_SINCE),
      },
    ]);
    TenantManager.countTenants.callsFake(async () => 1);
    MembershipManager.getOwnerMembershipsByTenantID.callsFake(async () => [
      { tenantId: TENANT, userId: OWNER, owner: true, status: "active" },
    ]);
    UserManager.getUsersById.callsFake(async () => [
      { id: OWNER, firstName: "Olaf", lastName: "Owner" },
    ]);
    BookableManager.countBookables.callsFake(async () => 2);
    EventManager.countEvents.callsFake(async () => 1);
    SupervisionHistoryManager.latestTenantRow.callsFake(async () => ({
      id: "h1",
      tenantId: TENANT,
      offerType: null,
      offerId: null,
      eventType: "tenant.created",
      occurredAt: new Date(WAITING_SINCE),
      actor: { type: "user", userId: OWNER },
      from: null,
      to: "pending",
      reason: null,
      origin: "api",
    }));
  });

  const get = (query = "", userId = ADMIN) => {
    const req = h.api().get(`/api/instances/tenant-approval-queue${query}`);
    return userId ? req.set(h.as(userId)) : req;
  };

  it("answers the instance owner one page of queue rows", async function () {
    const res = await get();

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      items: [
        {
          tenantId: TENANT,
          tenantName: "Verein",
          waitingSince: WAITING_SINCE,
          contact: {
            contactName: "Anna Admin",
            mail: "verein@example.test",
            phone: "0123",
            website: "https://verein.example.test",
            location: "Musterstadt",
          },
          owners: [{ userId: OWNER, displayName: "Olaf Owner", mail: OWNER }],
          offerCount: 3,
          lastChange: {
            id: "h1",
            tenantId: TENANT,
            offerType: null,
            offerId: null,
            eventType: "tenant.created",
            occurredAt: WAITING_SINCE,
            actor: { type: "user", userId: OWNER },
            from: null,
            to: "pending",
            reason: null,
            origin: "api",
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    expect(TenantManager.getTenants.lastCall.args[1]).to.include({
      supervisionLevel: "pending",
    });
  });

  it("refuses everyone but the instance owner", async function () {
    expect((await get("", OWNER)).status).to.equal(403);
    expect((await get("", ROLE_HOLDER)).status).to.equal(403);
    expect((await get("", CUSTOMER)).status).to.equal(403);
    expect((await get("", null)).status).to.equal(401);
  });

  it("hands the page to the database and answers it back", async function () {
    const res = await get("?page=3&pageSize=1");

    expect(res.status).to.equal(200);
    expect(res.body).to.include({ total: 1, page: 3, pageSize: 1 });
    expect(TenantManager.getTenants.lastCall.args[1]).to.include({
      skip: 2,
      limit: 1,
    });
  });

  it("does not swallow an infrastructure error as an empty queue", async function () {
    EventManager.countEvents.rejects(new Error("mongo down"));

    expect((await get()).status).to.equal(500);
  });
});
