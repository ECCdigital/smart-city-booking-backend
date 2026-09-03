/**
 * The invariants of the route markers and the order of the routers
 * (authorize spec §8.3).
 *
 * Every route under `src/platform` is to carry exactly one of the three
 * markers - `authorize`, `public`, `tokenAuthorized`. Until ticket 5 of
 * the chain marks the last router, this only lists the unmarked routes
 * (`LIST_UNMARKED_ROUTES=1` prints them one by one); ticket 5 turns the
 * list into a failure.
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
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const UserManager = require("../src/commons/data-managers/user-manager");
const AccessController = require("../src/platform/api/controllers/access-controller");
const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");

describe("authorization invariants: every route carries one marker", function () {
  it("lists the routes without a marker (a failure from ticket 5 on)", function () {
    const routes = routesOf(createApp());
    const unmarked = routes.filter((route) => route.markers.length === 0);
    const overMarked = routes.filter((route) => route.markers.length > 1);

    expect(overMarked, "routes with more than one marker").to.deep.equal([]);

    // eslint-disable-next-line no-console
    console.log(
      `      authorization markers: ${routes.length - unmarked.length} of ${routes.length} routes marked, ${unmarked.length} unmarked`,
    );
    if (process.env.LIST_UNMARKED_ROUTES === "1") {
      for (const route of unmarked) {
        // eslint-disable-next-line no-console
        console.log(`        ${route.method} ${route.path}`);
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
