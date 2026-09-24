/**
 * `GET /api/tenants/:tenant/readiness` (supervision spec §7, ticket 09):
 * the readiness check of one tenant for its owner and the instance owner,
 * over the lifecycle harness with the route world behind the managers.
 * The principal is loaded in the tenant of the path, so an owner of some
 * other tenant has no reach here.
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

describe("GET /api/tenants/:tenant/readiness", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      tenant: { contactName: "Erika Muster" },
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          isPublic: true,
          priceCategories: [{ priceEur: 10 }],
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

  const get = (path, userId) => {
    let req = h.api().get(`/api${path}`);
    if (userId) req = req.set(h.as(userId));
    return req;
  };

  it("answers the tenant owner and the instance owner the same criteria", async function () {
    const owner = await get(`/tenants/${TENANT}/readiness`, OWNER);
    expect(owner.status).to.equal(200);
    expect(owner.body.checkedAt).to.be.a("string");
    expect(owner.body.criteria.map((entry) => entry.key)).to.deep.equal([
      "contact",
      "legal",
      "offers",
      "schedule",
      "payment",
      "mail",
    ]);
    const payment = owner.body.criteria.find(
      (entry) => entry.key === "payment",
    );
    expect(payment.state).to.equal("fulfilled");
    const mail = owner.body.criteria.find((entry) => entry.key === "mail");
    expect(mail.transport).to.equal("instance");

    const admin = await get(`/tenants/${TENANT}/readiness`, ADMIN);
    expect(admin.status).to.equal(200);
    expect(admin.body.criteria).to.deep.equal(owner.body.criteria);
  });

  it("refuses the anonymous, a member and the owner of another tenant", async function () {
    expect((await get(`/tenants/${TENANT}/readiness`)).status).to.equal(401);
    expect(
      (await get(`/tenants/${TENANT}/readiness`, ROLE_HOLDER)).status,
    ).to.equal(403);
    expect(
      (await get(`/tenants/${TENANT}/readiness`, CUSTOMER)).status,
    ).to.equal(403);
    // The owner of `tenant-1` is nobody in `tenant-2`: the principal is
    // loaded in the tenant of the path.
    const foreign = await get("/tenants/tenant-2/readiness", OWNER);
    expect(foreign.status).to.equal(403);
    expect(foreign.body.code).to.equal("forbidden");
  });

  it("answers 404 for a tenant that does not exist", async function () {
    TenantManager.getTenant.restore();
    sinon.stub(TenantManager, "getTenant").resolves(null);
    const res = await get(`/tenants/${TENANT}/readiness`, ADMIN);
    expect(res.status).to.equal(404);
    expect(res.body.code).to.equal("tenant_not_found");
  });
});
