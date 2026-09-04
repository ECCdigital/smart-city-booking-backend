/**
 * The routes under `api/routes/*` on the authorization, end to end over the
 * lifecycle harness (authorize spec §3.1, ticket 4): access points and access
 * apps, the locker facade, the tenant catalog, the audit export, the scan
 * resolver and the calendars. What each principal reaches is the routes'
 * alone - the controllers ask nothing any more - and a refusal is the one
 * JSON form of `ForbiddenError`.
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
const AccessInfoService = require("../src/commons/services/access/access-info-service");

// The QR code of an access point encodes a store-front address.
process.env.STORE_FRONT_URL ||= "https://store.example.test";

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

describe("authorization on the access, locker, catalog and calendar routes", function () {
  this.timeout(20000);

  let h;
  // The harness and the route world stub in `before` and stand for the whole
  // suite; what a single test stubs goes into its own sandbox, so restoring
  // it does not take the world down with it.
  let sandbox;

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

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const call = (method, path, userId) => {
    let req = h.api()[method](`/api/${TENANT}${path}`);
    if (userId) req = req.set(h.as(userId));
    return req.send();
  };
  const get = (path, userId) => call("get", path, userId);

  it("opens the access points to whoever may read bookables, the writes to the tenant owner", async function () {
    expect((await get("/accesspoints/")).status).to.equal(401);

    const customer = await get("/accesspoints/", CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);

    expect((await get("/accesspoints/", ROLE_HOLDER)).status).to.equal(200);
    expect(
      (await get(`/accesspoints/${FIXTURE_ID}`, ROLE_HOLDER)).status,
    ).to.equal(200);

    // Writing is the tenant owner's: the role holder reads, nothing more.
    expect(
      (await get(`/accesspoints/${FIXTURE_ID}/qrcode`, ROLE_HOLDER)).status,
    ).to.equal(403);
    expect(
      (await get(`/accesspoints/${FIXTURE_ID}/qrcode`, OWNER)).status,
    ).to.equal(200);
    expect(
      (await call("delete", `/accesspoints/${FIXTURE_ID}`, ROLE_HOLDER)).status,
    ).to.equal(403);
    expect(
      (await call("delete", `/accesspoints/${FIXTURE_ID}`, OWNER)).status,
    ).to.equal(200);
  });

  it("puts the bookings of an access point on the booking reader, not the bookable reader", async function () {
    const path = `/accesspoints/${FIXTURE_ID}/bookings`;

    expect((await get(path)).status).to.equal(401);

    const customer = await get(path, CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);

    // The role holder of the world holds every level, `manageBookings.readAny`
    // among them; the tenant owner, who alone may delete the access point,
    // reaches it as well.
    expect((await get(path, ROLE_HOLDER)).status).to.equal(200);
    expect((await get(path, OWNER)).status).to.equal(200);
    expect((await get(path, ADMIN)).status).to.equal(200);
  });

  it("puts the access apps on the tenant owner, where the dead role group stood", async function () {
    // Reading the providers is the bookable reader's ...
    expect((await get("/access-apps/providers", ROLE_HOLDER)).status).to.equal(
      200,
    );
    expect((await get("/access-apps/providers", CUSTOMER)).status).to.equal(
      403,
    );

    // ... managing them the tenant owner's (§7.3).
    const roleHolder = await get("/access-apps/salto-ks/iqs", ROLE_HOLDER);
    expect(roleHolder.status).to.equal(403);
    expect(roleHolder.body).to.deep.equal(FORBIDDEN);
    expect((await get("/access-apps/salto-ks/iqs", OWNER)).status).to.not.equal(
      403,
    );
  });

  it("opens the locker facade and the audit export to whoever may read them", async function () {
    sandbox.stub(AccessInfoService, "getAccessPoints").resolves([]);

    expect((await get("/locker/nuki/locations", CUSTOMER)).status).to.equal(
      403,
    );
    expect((await get("/locker/nuki/locations", ROLE_HOLDER)).status).to.equal(
      200,
    );

    expect((await get("/access/audit/export", CUSTOMER)).status).to.equal(403);
    expect((await get("/access/audit/export", ROLE_HOLDER)).status).to.equal(
      200,
    );
  });

  it("keeps the scan resolver behind a login and nothing more", async function () {
    expect((await get("/access/resolve-scan/scan-fx")).status).to.equal(401);
    expect(
      (await get("/access/resolve-scan/scan-fx", CUSTOMER)).status,
    ).to.equal(200);
  });

  it("gives the tenant catalog to its owner and refuses the rest in the one form", async function () {
    const customer = await get("/catalog/", CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);
    expect((await get("/catalog/", ROLE_HOLDER)).status).to.equal(403);
    expect((await get("/catalog/", OWNER)).status).to.equal(200);
    expect((await get("/catalog/", ADMIN)).status).to.equal(200);
  });

  it("serves the calendars publicly and the bookings by their reach", async function () {
    expect((await get("/ical/events")).status).to.equal(200);
    expect((await get("/ical/feed/events")).status).to.equal(200);

    // The private events need a reach beyond `public`.
    expect((await get("/ical/events?includePrivate=true")).status).to.equal(
      401,
    );
    expect(
      (await get("/ical/events?includePrivate=true", CUSTOMER)).status,
    ).to.equal(403);
    expect(
      (await get("/ical/events?includePrivate=true", ROLE_HOLDER)).status,
    ).to.equal(200);

    // A booking calendar is the booking's own reach.
    expect((await get(`/ical/bookings/${FIXTURE_ID}`)).status).to.equal(401);
  });
});
