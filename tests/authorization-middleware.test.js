/**
 * The three route markers on a bare express app (authorize spec §2.4):
 * `authorize` answers 401 to the anonymous, 403 to the signed-in without
 * reach and hands the reach to the handler; `public` decides for the
 * anonymous too and never refuses; `tokenAuthorized` checks nothing. A
 * marker on an entry the table does not have, or `authorize` on a public
 * entry, throws when the router is built.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const sinon = require("sinon");
const { expect } = require("chai");

const { errorHandler } = require("../src/middleware/error-handler");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
  markerOf,
} = require("../src/commons/services/authorization/middleware");

const as = (userId) => ({
  Authorization: `Bearer ${jwt.sign({ sub: userId }, "irrelevant")}`,
});

/**
 * The permissions of the three users: a booking manager, a customer and
 * the owner of the tenant `t1`.
 */
function permissionsOf(userId) {
  const manager = userId === "manager";
  return {
    tenants: [
      {
        tenantId: "t1",
        isOwner: userId === "owner",
        manageBookings: manager ? { readAny: true, updateAny: true } : {},
      },
    ],
    instanceOwner: false,
    allowCreateTenant: false,
  };
}

function app(...routes) {
  const server = express();
  const router = express.Router({ mergeParams: true });
  for (const [path, ...handlers] of routes) {
    router.get(path, ...handlers);
  }
  server.use("/api/:tenant", router);
  server.use(errorHandler);
  return server;
}

const answer = (req, res) =>
  res.json({ reach: req.reach ?? null, user: req.principal?.userId ?? null });

describe("authorization middleware: the three markers", function () {
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
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("authorize(resource, action)", function () {
    const server = app(["/bookings", authorize("booking", "update"), answer]);

    it("answers 401 to the anonymous, like isSignedIn", async function () {
      const res = await request(server).get("/api/t1/bookings");
      expect(res.status).to.equal(401);
    });

    it("answers 403 without a body of its own to a signed-in user without reach", async function () {
      const res = await request(server)
        .get("/api/t1/bookings")
        .set(as("customer"));
      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal("forbidden");
    });

    it("hands the reach to the handler", async function () {
      const res = await request(server)
        .get("/api/t1/bookings")
        .set(as("manager"));
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ reach: "any", user: "manager" });
    });

    it("gives the widest reach of the principal", async function () {
      const reads = app([
        "/bookings",
        authorize("booking", "document"),
        answer,
      ]);
      const manager = await request(reads)
        .get("/api/t1/bookings")
        .set(as("manager"));
      const customer = await request(reads)
        .get("/api/t1/bookings")
        .set(as("customer"));
      expect(manager.body.reach).to.equal("any");
      expect(customer.body.reach).to.equal("own");
    });

    it("loads the principal once per request", async function () {
      const twice = app([
        "/bookings",
        authorize("booking", "document"),
        authorize("booking", "document"),
        answer,
      ]);
      await request(twice).get("/api/t1/bookings").set(as("manager"));
      expect(UserManager.getUserPermissions.callCount).to.equal(1);
    });

    it("takes the tenant from tenantOf where the route carries no :tenant", async function () {
      // `PUT /api/tenants` names its tenant in the body, not in the path.
      const server = express();
      const router = express.Router();
      router.get(
        "/tenants",
        authorize("tenant", "update", { tenantOf: (req) => req.query.id }),
        answer,
      );
      server.use("/api", router);
      server.use(errorHandler);

      const own = await request(server)
        .get("/api/tenants?id=t1")
        .set(as("owner"));
      expect(own.status).to.equal(200);
      expect(own.body).to.deep.equal({ reach: "any", user: "owner" });

      const foreign = await request(server)
        .get("/api/tenants?id=t2")
        .set(as("owner"));
      expect(foreign.status).to.equal(403);

      const none = await request(server).get("/api/tenants").set(as("owner"));
      expect(none.status).to.equal(403);
    });

    it("refuses an unknown entry and a public one when the router is built", function () {
      expect(() => authorize("booking", "fly")).to.throw(/booking\.fly/);
      expect(() => authorize("unicorn", "read")).to.throw(/unicorn/);
      expect(() => authorize("event", "read")).to.throw(/public/);
    });

    it("carries its marker", function () {
      expect(markerOf(authorize("booking", "document"))).to.deep.equal({
        marker: "authorize",
        resource: "booking",
        action: "document",
      });
    });
  });

  describe("public(resource?, action?)", function () {
    const server = app(["/events", publicRoute("event", "read"), answer]);

    it("decides for the anonymous too and never refuses", async function () {
      const anonymous = await request(server).get("/api/t1/events");
      const customer = await request(server)
        .get("/api/t1/events")
        .set(as("customer"));
      expect(anonymous.status).to.equal(200);
      expect(anonymous.body).to.deep.equal({ reach: "public", user: null });
      expect(customer.body).to.deep.equal({
        reach: "public",
        user: "customer",
      });
    });

    it("treats an invalid token as anonymous, like optionalAuth", async function () {
      JwtHelper.verifyToken.throws(new Error("bad"));
      const res = await request(server)
        .get("/api/t1/events")
        .set({ Authorization: "Bearer nonsense" });
      expect(res.status).to.equal(200);
      expect(res.body.user).to.equal(null);
    });

    it("answers public without arguments", async function () {
      const plain = app(["/holidays", publicRoute(), answer]);
      const res = await request(plain).get("/api/t1/holidays");
      expect(res.body.reach).to.equal("public");
      expect(markerOf(publicRoute()).marker).to.equal("public");
    });

    it("refuses an entry that is not public when the router is built", function () {
      expect(() => publicRoute("booking", "update")).to.throw(/not public/);
      expect(() => publicRoute("booking", "fly")).to.throw(/booking\.fly/);
    });
  });

  describe("tokenAuthorized()", function () {
    it("checks nothing and carries its marker", async function () {
      const server = app(["/hooks", tokenAuthorized(), answer]);
      const res = await request(server).get("/api/t1/hooks");
      expect(res.status).to.equal(200);
      expect(markerOf(tokenAuthorized()).marker).to.equal("tokenAuthorized");
    });
  });
});
