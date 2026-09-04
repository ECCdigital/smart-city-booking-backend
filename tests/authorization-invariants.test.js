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

const { createApp } = require("./helpers/booking-lifecycle-harness");
const { routesOf } = require("./helpers/route-inventory");
const { entryOf } = require("../src/commons/services/authorization/policy");
const { MARKER } = require("../src/commons/services/authorization/middleware");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const UserManager = require("../src/commons/data-managers/user-manager");
const AccessController = require("../src/platform/api/controllers/access-controller");
const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");

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
