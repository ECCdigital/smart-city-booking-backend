/**
 * The invariants of the route markers and the order of the routers
 * (authorize spec §8.3).
 *
 * Every route under `src/platform` carries exactly one of the three
 * markers - `authorize`, `public`, `tokenAuthorized`. Ticket 5 of the
 * chain marked the last router, so an unmarked route is a failure here
 * and names itself: a route added without a marker is a route nobody
 * decided about.
 *
 * The two order comments of the routers become tests here: a scan code
 * is never read as an access point id, and `instance` is never read as a
 * tenant id.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const sinon = require("sinon");
const { expect } = require("chai");

const {
  createApp,
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const { Booking } = require("../src/commons/entities/booking/booking");
const { routesOf } = require("./helpers/route-inventory");
const { entryOf } = require("../src/commons/services/authorization/policy");
const { MARKER } = require("../src/commons/services/authorization/middleware");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const UserManager = require("../src/commons/data-managers/user-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  supervisionOf,
} = require("../src/commons/services/supervision/supervision-constants");
const { errorHandler } = require("../src/middleware/error-handler");
const {
  authorize,
  publicRoute,
} = require("../src/commons/services/authorization/middleware");
const AccessController = require("../src/platform/api/controllers/access-controller");
const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");
const MediaManager = require("../src/commons/data-managers/media-manager");
const { Media } = require("../src/commons/entities/media/media");
const AccessService = require("../src/commons/services/access/access-service");
const {
  DashboardCache,
} = require("../src/commons/services/dashboard/dashboard-cache");

describe("authorization invariants: every route carries one marker", function () {
  /** `GET /api/foo` for every route, to name the offenders in the message. */
  const named = (routes) => routes.map((r) => `${r.method} ${r.path}`);

  it("leaves no route unmarked", function () {
    const routes = routesOf(createApp());
    const unmarked = routes.filter((route) => route.markers.length === 0);

    expect(named(unmarked), "routes without a marker").to.deep.equal([]);
    expect(routes.length).to.be.greaterThan(0);
  });

  it("marks no route twice", function () {
    const routes = routesOf(createApp());
    const overMarked = routes.filter((route) => route.markers.length > 1);

    expect(named(overMarked), "routes with more than one marker").to.deep.equal(
      [],
    );
  });

  it("puts a public entry only behind public(), and authorize() only on the rest", function () {
    for (const route of routesOf(createApp())) {
      for (const marker of route.markers) {
        if (marker.resource === null) {
          continue;
        }
        const entry = entryOf(marker.resource, marker.action);
        const where = `${route.method} ${route.path}`;
        if (marker.marker === MARKER.PUBLIC) {
          expect(entry.public, where).to.equal(true);
        } else {
          expect(entry.public, where).to.not.equal(true);
        }
      }
    }
  });
});

/** A fresh copy of a router module: bound to the stubs of the test. */
function freshRouter(modulePath, ...alsoFresh) {
  for (const path of [modulePath, ...alsoFresh]) {
    delete require.cache[require.resolve(path)];
  }
  const router = require(modulePath);
  for (const path of [modulePath, ...alsoFresh]) {
    delete require.cache[require.resolve(path)];
  }
  return router;
}

const as = (userId) => ({
  Authorization: `Bearer ${jwt.sign({ sub: userId }, "irrelevant")}`,
});

describe("authorization invariants: the order of the routers", function () {
  beforeEach(function () {
    sinon.stub(JwtHelper, "verifyToken").callsFake((token) => ({
      sub: jwt.decode(token).sub,
      v: 2,
      type: "access",
    }));
    sinon.stub(UserManager, "getUser").callsFake(async (id) => ({ id }));
    // The markers load the principal; an instance owner passes every route,
    // so the order of the routes is what these two tests read.
    sinon.stub(UserManager, "getUserPermissions").resolves({
      tenants: [],
      instanceOwner: true,
      allowCreateTenant: false,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  it("answers a scan code from the scan resolver, never as an access point id", async function () {
    const resolveScan = sinon
      .stub(AccessController, "resolveScan")
      .callsFake((req, res) => res.json({ scanCode: req.params.scanCode }));
    const getStatus = sinon
      .stub(AccessController, "getStatus")
      .callsFake((req, res) =>
        res.json({ accessPointId: req.params.accessPointId }),
      );
    const app = express();
    app.use(
      "/api/:tenant/access",
      freshRouter("../src/platform/api/routes/access.routes"),
    );

    // A scan code that reads like the tail of `/:accessPointId/status`.
    const res = await request(app)
      .get("/api/t1/access/resolve-scan/status")
      .set(as("user-1"));

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ scanCode: "status" });
    expect(resolveScan.calledOnce).to.equal(true);
    expect(getStatus.called).to.equal(false);
  });

  it("answers /api/v2/instance/media from the instance library, never as a tenant", async function () {
    const list = sinon
      .stub(MediaControllerV2, "getMediaList")
      .callsFake((req, res) => res.json({ tenant: req.params.tenant ?? null }));
    const app = express();
    app.use(
      "/api/v2",
      freshRouter(
        "../src/platform/api/v2/routes",
        "../src/platform/api/v2/routes/instance.media.routes",
        "../src/platform/api/v2/routes/tenant.media.routes",
      ),
    );

    const instance = await request(app)
      .get("/api/v2/instance/media")
      .set(as("user-1"));
    const tenant = await request(app).get("/api/v2/t1/media").set(as("user-1"));

    expect(instance.status).to.equal(200);
    expect(instance.body).to.deep.equal({ tenant: null });
    expect(tenant.body).to.deep.equal({ tenant: "t1" });
    expect(list.callCount).to.equal(2);
  });
});

/**
 * The management gate of a declined tenant (tenant supervision spec §6.1,
 * glossary "abgewiesen"): after the rights decision `authorize` loads the
 * tenant of the route - only when the rule was satisfied as tenant owner
 * or role holder - and refuses a declined one with `403 tenant_declined`,
 * unless the rule is one any signed-in user satisfies. The instance owner
 * and the public are never asked; an unknown tenant passes.
 */
describe("authorization invariants: the management gate of a declined tenant", function () {
  const CHANGED_AT = new Date("2026-09-24T10:00:00.000Z");
  /** The tenants by id: `t-declined` is declined, `t-free` is free. */
  const tenants = {
    "t-declined": {
      id: "t-declined",
      supervisionLevel: "declined",
      supervisionChangedAt: CHANGED_AT,
      supervisionReason: "Kein Impressum",
    },
    "t-free": { id: "t-free", supervisionLevel: "free" },
  };

  /**
   * Everyone is a member of every tenant - `t-unknown`, whose document is
   * gone, included: owner, manager or plain. Each membership carries the
   * supervision of its tenant, as the sign-in answer does.
   */
  function permissionsOf(userId) {
    const membership = (tenantId) => ({
      tenantId,
      isOwner: userId === "owner",
      manageBookables: userId === "manager" ? { readAny: true } : {},
      manageBookings: userId === "manager" ? { updateAny: true } : {},
      ...supervisionOf(tenants[tenantId] ?? null),
    });
    return {
      tenants: [...Object.keys(tenants), "t-unknown"].map(membership),
      instanceOwner: userId === "admin",
      allowCreateTenant: false,
    };
  }

  const answer = (req, res) =>
    res.json({ reach: req.reach ?? null, user: req.principal?.userId });

  function app() {
    const server = express();
    server.use(express.json());
    const tenantRouter = express.Router({ mergeParams: true });
    tenantRouter.get("/bookables", authorize("bookable", "read"), answer);
    tenantRouter.get("/bookings/:id", authorize("booking", "read"), answer);
    tenantRouter.get("/access", authorize("booking", "operate"), answer);
    tenantRouter.get("/events", publicRoute("event", "read"), answer);
    server.use("/api/:tenant", tenantRouter);
    const instanceRouter = express.Router();
    instanceRouter.put(
      "/tenants",
      authorize("tenant", "update", { tenantOf: (req) => req.body?.id }),
      answer,
    );
    instanceRouter.get("/tenants/:tenant", authorize("tenant", "read"), answer);
    instanceRouter.get(
      "/tenants/:tenant/missing",
      authorize("tenant", "read"),
      (req, res) => res.status(404).json({ code: "tenant_not_found" }),
    );
    server.use("/api", instanceRouter);
    server.use(errorHandler);
    return server;
  }

  beforeEach(function () {
    sinon.stub(JwtHelper, "verifyToken").callsFake((token) => ({
      sub: jwt.decode(token).sub,
      v: 2,
      type: "access",
    }));
    sinon.stub(UserManager, "getUser").callsFake(async (id) => ({ id }));
    sinon
      .stub(UserManager, "getUserPermissions")
      .callsFake(async (id) => permissionsOf(id));
    sinon
      .stub(TenantManager, "getTenant")
      .callsFake(async (id) => tenants[id] ?? null);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("refuses the tenant's staff on a management route with 403 tenant_declined and the tenant's supervision", async function () {
    for (const userId of ["owner", "manager"]) {
      const res = await request(app())
        .get("/api/t-declined/bookables")
        .set(as(userId));
      expect(res.status, userId).to.equal(403);
      expect(res.body.code, userId).to.equal("tenant_declined");
      expect(res.body.params, userId).to.deep.equal({
        tenantId: "t-declined",
        supervisionLevel: "declined",
        supervisionChangedAt: CHANGED_AT.toISOString(),
        supervisionReason: "Kein Impressum",
      });
    }
  });

  it("leaves the same staff their reach in a free tenant", async function () {
    const res = await request(app())
      .get("/api/t-free/bookables")
      .set(as("manager"));
    expect(res.status).to.equal(200);
    expect(res.body.reach).to.equal("any");
  });

  it("keeps a rule any signed-in user satisfies open, at that reach - for the tenant owner too", async function () {
    const customer = await request(app())
      .get("/api/t-declined/bookings/b1")
      .set(as("customer"));
    expect(customer.status).to.equal(200);
    expect(customer.body.reach).to.equal("own");

    const owner = await request(app())
      .get("/api/t-declined/bookings/b1")
      .set(as("owner"));
    expect(owner.status).to.equal(200);
    expect(owner.body.reach).to.equal("own");
  });

  it("closes booking.operate over any for the manager, and leaves it open over own", async function () {
    const free = await request(app())
      .get("/api/t-free/access")
      .set(as("manager"));
    expect(free.body.reach).to.equal("any");

    const declined = await request(app())
      .get("/api/t-declined/access")
      .set(as("manager"));
    expect(declined.status).to.equal(200);
    expect(declined.body.reach).to.equal("own");
  });

  it("never loads the tenant: its supervision comes with the principal", async function () {
    const owner = await request(app())
      .get("/api/t-declined/bookables")
      .set(as("owner"));
    expect(owner.status).to.equal(403);
    const customer = await request(app())
      .get("/api/t-declined/bookings/b1")
      .set(as("customer"));
    expect(customer.status).to.equal(200);
    const admin = await request(app())
      .get("/api/t-declined/bookables")
      .set(as("admin"));
    expect(admin.status).to.equal(200);
    expect(admin.body.reach).to.equal("any");
    const anonymous = await request(app()).get("/api/t-declined/events");
    expect(anonymous.status).to.equal(200);

    expect(TenantManager.getTenant.called).to.equal(false);
  });

  it("refuses a member who lacks the right with the declination too, and passes an unknown tenant to the handler", async function () {
    const plain = await request(app())
      .get("/api/t-declined/bookables")
      .set(as("plain"));
    expect(plain.status).to.equal(403);
    expect(plain.body.code).to.equal("tenant_declined");
    const free = await request(app())
      .get("/api/t-free/bookables")
      .set(as("plain"));
    expect(free.status).to.equal(403);
    expect(free.body.code).to.equal("forbidden");

    const unknown = await request(app())
      .get("/api/tenants/t-unknown/missing")
      .set(as("owner"));
    expect(unknown.status).to.equal(404);
    expect(unknown.body.code).to.equal("tenant_not_found");
  });

  it("covers the instance router: the tenant of the path and of the body of PUT /api/tenants", async function () {
    const read = await request(app())
      .get("/api/tenants/t-declined")
      .set(as("owner"));
    expect(read.status).to.equal(403);
    expect(read.body.code).to.equal("tenant_declined");

    const put = await request(app())
      .put("/api/tenants")
      .set(as("owner"))
      .send({ id: "t-declined", name: "Verein" });
    expect(put.status).to.equal(403);
    expect(put.body.code).to.equal("tenant_declined");

    const free = await request(app())
      .put("/api/tenants")
      .set(as("owner"))
      .send({ id: "t-free", name: "Verein" });
    expect(free.status).to.equal(200);
  });
});

/**
 * The same gate over every router of the platform: `/api/:tenant`,
 * `/api/tenants/:tenant`, `/api/v2/:tenant`, `/csv/:tenant` and
 * `PUT /api/tenants` with the tenant in the body - nothing lists itself.
 */
describe("authorization invariants: the declined tenant on the routers", function () {
  this.timeout(30000);

  const CHANGED_AT = "2026-09-24T10:00:00.000Z";
  let h;

  /** A confirmed booking of a user, in the harness' store. */
  const bookingOf = (id, userId) =>
    JSON.parse(
      JSON.stringify(
        new Booking({
          id,
          tenantId: TENANT,
          assignedUserId: userId,
          mail: userId,
          name: "Wer bucht",
          status: "confirmed",
          priceEur: 40,
          paymentProvider: "giroCockpit",
          timeBegin: TIME_BEGIN,
          timeEnd: TIME_END,
          bookableItems: [{ bookableId: FIXTURE_ID, amount: 1 }],
          attachments: [],
          accessInfo: [],
          hooks: [],
        }),
      ),
    );

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
    // The customer's own booking, and one the tenant owner made in the
    // own tenant.
    h.store.set(FIXTURE_ID, bookingOf(FIXTURE_ID, CUSTOMER));
    h.store.set("own-of-owner", bookingOf("own-of-owner", OWNER));
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    delete h.tenant.supervisionChangedAt;
    delete h.tenant.supervisionReason;
  });

  function decline() {
    h.tenant.supervisionLevel = "declined";
    h.tenant.supervisionChangedAt = new Date(CHANGED_AT);
    h.tenant.supervisionReason = "Kein Impressum";
  }

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };

  /** A management route per router, with the staff it is open to when free. */
  const MANAGEMENT = [
    ["get", `/api/${TENANT}/bookables`, OWNER],
    ["get", `/api/${TENANT}/bookables`, ROLE_HOLDER],
    ["get", `/api/tenants/${TENANT}`, OWNER],
    ["get", `/api/tenants/${TENANT}/supervision/history`, OWNER],
    ["get", `/api/tenants/${TENANT}/readiness`, OWNER],
    ["put", `/api/tenants`, OWNER, { id: TENANT, name: "Verein" }],
    ["get", `/api/v2/${TENANT}/media`, ROLE_HOLDER],
    ["get", `/csv/${TENANT}/events/${FIXTURE_ID}/bookings`, ROLE_HOLDER],
    ["get", `/api/${TENANT}/users`, ROLE_HOLDER],
  ];

  /** What any signed-in user has: the own booking and what hangs on it. */
  const SIGNED_IN = [
    ["get", `/api/${TENANT}/bookings/${FIXTURE_ID}`, CUSTOMER],
    ["get", `/api/${TENANT}/bookings/own-of-owner`, OWNER],
    ["get", `/api/${TENANT}/bookings/${FIXTURE_ID}/receipt`, CUSTOMER],
    ["get", `/api/${TENANT}/bookings/own-of-owner/receipt`, OWNER],
    [
      "get",
      `/api/${TENANT}/bookings/${FIXTURE_ID}/cancellation-refund-preview`,
      CUSTOMER,
    ],
    [
      "get",
      `/api/${TENANT}/bookings/own-of-owner/cancellation-refund-preview`,
      OWNER,
    ],
    ["get", `/api/${TENANT}/access`, CUSTOMER],
    ["get", `/api/${TENANT}/access`, OWNER],
    ["get", `/api/${TENANT}/invitations/${FIXTURE_ID}/verify`, CUSTOMER],
    ["get", `/api/${TENANT}/invitations/${FIXTURE_ID}/verify`, OWNER],
  ];

  it("refuses the staff on every router with 403 tenant_declined, the instance owner on none", async function () {
    const open = [];
    for (const [method, path, userId, body] of MANAGEMENT) {
      const res = await call(method, path, userId, body);
      if (res.status === 403 || res.status === 401) {
        open.push(`${method} ${path} as ${userId} is ${res.status} when free`);
      }
    }
    expect(open).to.deep.equal([]);

    decline();
    const wrong = [];
    for (const [method, path, userId, body] of MANAGEMENT) {
      const res = await call(method, path, userId, body);
      if (res.status !== 403 || res.body.code !== "tenant_declined") {
        wrong.push(`${method} ${path} as ${userId} -> ${res.status}`);
      }
    }
    expect(wrong).to.deep.equal([]);

    const res = await call("get", `/api/tenants/${TENANT}`, OWNER);
    expect(res.body.params).to.deep.equal({
      tenantId: TENANT,
      supervisionLevel: "declined",
      supervisionChangedAt: CHANGED_AT,
      supervisionReason: "Kein Impressum",
    });

    for (const [method, path, , body] of MANAGEMENT) {
      const admin = await call(method, path, ADMIN, body);
      expect(
        admin.status,
        `${method} ${path} as the instance owner`,
      ).to.not.equal(403);
    }
  });

  it("leaves a customer and a tenant owner who booked in the declined tenant their own booking", async function () {
    const before = {};
    for (const [method, path, userId] of SIGNED_IN) {
      before[`${path} ${userId}`] = (await call(method, path, userId)).status;
    }
    expect(
      before[`/api/${TENANT}/bookings/${FIXTURE_ID} ${CUSTOMER}`],
    ).to.equal(200);
    expect(before[`/api/${TENANT}/bookings/own-of-owner ${OWNER}`]).to.equal(
      200,
    );

    decline();
    const wrong = [];
    for (const [method, path, userId] of SIGNED_IN) {
      const res = await call(method, path, userId);
      if (res.status !== before[`${path} ${userId}`]) {
        wrong.push(
          `${path} as ${userId}: ${before[`${path} ${userId}`]} -> ${res.status}`,
        );
      }
    }
    expect(wrong).to.deep.equal([]);
  });

  it("narrows the tenant owner to the own bookings: the customer's is out of reach", async function () {
    expect(
      (await call("get", `/api/${TENANT}/bookings/${FIXTURE_ID}`, OWNER))
        .status,
    ).to.equal(200);
    decline();
    expect(
      (await call("get", `/api/${TENANT}/bookings/${FIXTURE_ID}`, OWNER))
        .status,
    ).to.equal(404);
  });

  // Every path that decides from the principal - not only the marker of
  // `authorize` - meets the membership of a declined tenant resting
  // (glossary "Ruhende Mitgliedschaft"); a pending tenant rests nothing.

  /** Runs `probe` with the tenant free, pending and declined. */
  async function acrossLevels(probe) {
    const answers = {};
    for (const level of ["free", "pending", "declined"]) {
      if (level === "declined") {
        decline();
      } else {
        h.tenant.supervisionLevel = level;
      }
      answers[level] = await probe();
    }
    return answers;
  }

  /** A medium of the tenant, as the route world has it by default. */
  const mediumOf = ({ uploadedBy = ROLE_HOLDER, visibility = "public" } = {}) =>
    new Media({
      id: FIXTURE_ID,
      tenantId: TENANT,
      kind: "image",
      mimeType: "image/png",
      size: 7,
      originalFileName: "bild.png",
      uploadedBy,
      visibility,
      storage: { provider: "s3", key: "fx" },
    });

  it("narrows GET /bookings for the staff of a declined tenant to what any signed-in user has", async function () {
    const idsOf =
      (userId, query = "") =>
      async () => {
        const res = await call(
          "get",
          `/api/${TENANT}/bookings${query}`,
          userId,
        );
        expect(res.status, `${userId}${query}`).to.equal(200);
        return res.body.map((booking) => booking.id).sort();
      };
    const all = [FIXTURE_ID, "own-of-owner"].sort();

    expect(await acrossLevels(idsOf(ROLE_HOLDER))).to.deep.equal({
      free: all,
      pending: all,
      declined: [],
    });
    expect(await acrossLevels(idsOf(OWNER))).to.deep.equal({
      free: all,
      pending: all,
      declined: ["own-of-owner"],
    });
    // The anonymized projection: the management sees it whole, anyone
    // else gets the public's answer - of a declined tenant, none.
    const projection = (userId) => async () =>
      (await call("get", `/api/${TENANT}/bookings?public=true`, userId)).status;
    expect(await acrossLevels(projection(ROLE_HOLDER))).to.deep.equal({
      free: 200,
      pending: 200,
      declined: 404,
    });
    expect((await acrossLevels(projection(null))).declined).to.equal(404);
  });

  it("refuses the metadata of a medium to the staff of a declined tenant", async function () {
    for (const userId of [ROLE_HOLDER, OWNER]) {
      const statuses = await acrossLevels(
        async () =>
          (await call("get", `/api/v2/${TENANT}/media/${FIXTURE_ID}`, userId))
            .status,
      );
      expect(statuses, userId).to.deep.equal({
        free: 200,
        pending: 200,
        declined: 403,
      });
    }
  });

  it("closes the files of a declined tenant to its members", async function () {
    try {
      for (const [visibility, refused] of [
        ["intern", 403],
        ["public", 404],
      ]) {
        MediaManager.getMedia.callsFake(async () =>
          mediumOf({ uploadedBy: "someone-else", visibility }),
        );
        const statuses = await acrossLevels(
          async () =>
            (
              await call(
                "get",
                `/api/v2/${TENANT}/media/${FIXTURE_ID}/file`,
                CUSTOMER,
              )
            ).status,
        );
        expect(statuses, visibility).to.deep.equal({
          free: 200,
          pending: 200,
          declined: refused,
        });
      }
    } finally {
      MediaManager.getMedia.callsFake(async () => mediumOf());
    }
  });

  it("answers the access bookings that the staff of a declined tenant manage nothing there", async function () {
    const spy = sinon.spy(AccessService, "getUserBookingsWithAccess");
    try {
      const manages = await acrossLevels(async () => {
        spy.resetHistory();
        const res = await call("get", "/api/access/bookings", ROLE_HOLDER);
        expect(res.status).to.equal(200);
        return spy.firstCall.args[1].canManageIn(TENANT);
      });
      expect(manages).to.deep.equal({
        free: true,
        pending: true,
        declined: false,
      });
    } finally {
      spy.restore();
    }
  });

  it("leaves a declined tenant out of the instance dashboard of its staff", async function () {
    const statuses = await acrossLevels(async () => {
      DashboardCache.invalidateAll();
      return (await call("get", "/api/v2/dashboard/summary", ROLE_HOLDER))
        .status;
    });
    expect(statuses).to.deep.equal({ free: 200, pending: 200, declined: 403 });
  });

  it("lists a declined tenant for its owner only as one they are a member of", async function () {
    const idsOf = (query) => async () => {
      const res = await call("get", `/api/tenants${query}`, OWNER);
      expect(res.status, query).to.equal(200);
      return res.body.map((tenant) => tenant.id);
    };
    expect(await acrossLevels(idsOf(""))).to.deep.equal({
      free: [TENANT],
      pending: [TENANT],
      declined: [],
    });
    expect(await acrossLevels(idsOf("?publicTenants=true"))).to.deep.equal({
      free: [TENANT],
      pending: [TENANT],
      declined: [TENANT],
    });
  });
});
