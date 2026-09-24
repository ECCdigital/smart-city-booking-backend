/**
 * `GET /api/instances/review-queue` (tenant supervision spec §6.2) over
 * the lifecycle harness: the instance owner alone reads the active review
 * queue, paginated and narrowed by tenant and offer type.
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
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");

const SUBMITTED_AT = "2026-09-01T10:00:00.000Z";

describe("GET /api/instances/review-queue", function () {
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
      { id: TENANT, name: "Verein", supervisionLevel: "supervised" },
    ]);
    BookableManager.getPendingReviewOffers.callsFake(async () => [
      {
        id: "b1",
        tenantId: TENANT,
        title: "Saal",
        type: "room",
        isPublic: false,
        review: { status: "pending", submittedAt: new Date(SUBMITTED_AT) },
      },
    ]);
    EventManager.getPendingReviewOffers.callsFake(async () => [
      {
        id: "e1",
        tenantId: TENANT,
        information: { name: "Konzert" },
        isPublic: true,
        review: {
          status: "pending",
          submittedAt: new Date("2026-09-02T10:00:00.000Z"),
        },
      },
    ]);
  });

  const get = (query = "", userId = ADMIN) => {
    const req = h.api().get(`/api/instances/review-queue${query}`);
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
          offerType: "bookable",
          offerId: "b1",
          title: "Saal",
          submittedAt: SUBMITTED_AT,
          isPublic: false,
          adminPath: "/rooms/edit?id=b1",
        },
        {
          tenantId: TENANT,
          tenantName: "Verein",
          offerType: "event",
          offerId: "e1",
          title: "Konzert",
          submittedAt: "2026-09-02T10:00:00.000Z",
          isPublic: true,
          adminPath: "/events/edit?id=e1",
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    expect(TenantManager.getTenants.lastCall.args[1]).to.include({
      supervisionLevel: "supervised",
    });
  });

  it("refuses everyone but the instance owner", async function () {
    expect((await get("", OWNER)).status).to.equal(403);
    expect((await get("", ROLE_HOLDER)).status).to.equal(403);
    expect((await get("", CUSTOMER)).status).to.equal(403);
    expect((await get("", null)).status).to.equal(401);
  });

  it("paginates and narrows by offer type and tenant", async function () {
    const page = await get("?page=2&pageSize=1");
    expect(page.status).to.equal(200);
    expect(page.body.items.map((row) => row.offerId)).to.deep.equal(["e1"]);
    expect(page.body).to.include({ total: 2, page: 2, pageSize: 1 });

    const eventsOnly = await get("?offerType=event");
    expect(eventsOnly.body.items.map((row) => row.offerId)).to.deep.equal([
      "e1",
    ]);
    expect(eventsOnly.body.total).to.equal(1);

    const otherTenant = await get("?tenantId=another-tenant");
    expect(otherTenant.status).to.equal(200);
    expect(otherTenant.body).to.include({ total: 0 });
  });

  it("refuses an unknown offer type with 400", async function () {
    const res = await get("?offerType=coupon");

    expect(res.status).to.equal(400);
    expect(res.body.code).to.equal("invalid_offer_type");
  });

  it("does not swallow an infrastructure error as an empty queue", async function () {
    BookableManager.getPendingReviewOffers.rejects(new Error("mongo down"));

    expect((await get()).status).to.equal(500);
  });
});
