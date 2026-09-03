/**
 * The instance router on the authorization, end to end over the lifecycle
 * harness (authorize spec §3.2, ticket 3): the instance owner reaches the
 * instance, the tenant owner the tenant the route names - in the path or,
 * at `PUT /tenants`, in the body - and everybody else is refused in the
 * one JSON form before the handler. The tenant list hands the reach to
 * its manager, the cross-tenant access bookings answer another user's
 * to the instance owner only.
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
const AccessService = require("../src/commons/services/access/access-service");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

describe("authorization on the instance router", function () {
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
    sinon.stub(AccessService, "getUserBookingsWithAccess").resolves([]);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](`/api${path}`);
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };
  const get = (path, userId) => call("get", path, userId);

  it("opens the instance to its owner and refuses everyone else in the one form", async function () {
    expect((await get("/instances")).status).to.equal(401);
    const customer = await get("/instances", CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);
    expect((await get("/instances", OWNER)).status).to.equal(403);
    expect((await get("/instances", ADMIN)).status).to.equal(200);
    expect((await get("/rules", ADMIN)).status).to.equal(200);
    expect((await get("/rules", ROLE_HOLDER)).status).to.equal(403);
  });

  it("names the tenant in the path: the tenant owner reaches it, a member does not", async function () {
    expect((await get(`/tenants/${TENANT}`, OWNER)).status).to.equal(200);
    expect((await get(`/tenants/${TENANT}`, ADMIN)).status).to.equal(200);
    expect((await get(`/tenants/${TENANT}`, ROLE_HOLDER)).status).to.equal(403);
    // The route the tenant router shares: alive again under `:tenant`.
    const users = await get(`/tenants/${TENANT}/users`, OWNER);
    expect(users.status).to.equal(200);
    expect(users.body).to.have.property("users");
  });

  it("names the tenant in the body at PUT /tenants", async function () {
    const owner = await call("put", "/tenants", OWNER, { id: TENANT });
    expect(owner.status).to.equal(200);
    const holder = await call("put", "/tenants", ROLE_HOLDER, { id: TENANT });
    expect(holder.status).to.equal(403);
    expect((await call("put", "/tenants", OWNER, {})).status).to.equal(403);
  });

  it("opens a tenant to whom the instance lets, over POST /tenants", async function () {
    expect(
      (await call("post", "/tenants", CUSTOMER, { name: "Neu" })).status,
    ).to.equal(403);
    expect(
      (await call("post", "/tenants", ADMIN, { name: "Neu" })).status,
    ).to.equal(201);
  });

  it("hands the tenant list its reach", async function () {
    await get("/tenants", CUSTOMER);
    expect(TenantManager.getTenants.lastCall.args).to.deep.equal([
      { reach: "own", userId: CUSTOMER },
      { owned: true },
    ]);
    await get("/tenants?publicTenants=true", CUSTOMER);
    expect(TenantManager.getTenants.lastCall.args[1]).to.deep.equal({
      owned: false,
    });
    await get("/tenants", ADMIN);
    expect(TenantManager.getTenants.lastCall.args[0]).to.deep.equal({
      reach: "any",
      userId: ADMIN,
    });
  });

  it("answers another user's access bookings to the instance owner only", async function () {
    expect((await get("/access/bookings", CUSTOMER)).status).to.equal(200);
    expect(
      (await get("/access/bookings?userId=max@example.test", CUSTOMER)).status,
    ).to.equal(403);
    expect(
      (await get("/access/bookings?userId=max@example.test", ADMIN)).status,
    ).to.equal(200);
  });

  it("closes the user directory to everyone but the instance owner", async function () {
    expect((await get("/users", OWNER)).status).to.equal(403);
    expect((await get("/users", ADMIN)).status).to.equal(200);
    expect((await get("/user", CUSTOMER)).status).to.not.equal(403);
  });

  it("keeps the public routes public", async function () {
    expect((await get("/catalog/public")).status).to.equal(200);
    expect((await get("/instances/public")).status).to.equal(200);
    expect((await get("/tenants/public")).status).to.equal(200);
    expect((await get("/holidays")).status).to.equal(200);
  });
});
