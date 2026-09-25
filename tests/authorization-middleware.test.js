/**
 * The three route markers on a bare express app (glossary "Berechtigung"):
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
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
  markerOf,
  reachesOf,
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
    // The management gate of a declined tenant loads the tenant for the
    // staff; here every tenant is free.
    sinon
      .stub(TenantManager, "getTenant")
      .callsFake(async (id) => ({ id, supervisionLevel: "free" }));
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

    describe("also: the second decision of a route on the marker (ADR 0001)", function () {
      const answerReaches = (req, res) =>
        res.json({ reach: req.reach ?? null, reaches: req.reaches ?? null });
      const upsert = app([
        "/bookings",
        authorize("booking", "update", { also: ["create"] }),
        answerReaches,
      ]);
      const twoResources = app([
        "/users",
        authorize("tenantUser", "manage", {
          also: ["owner", "instanceCatalog.store"],
        }),
        answerReaches,
      ]);

      it("hands the reach of the main action as req.reach and the others as req.reaches", async function () {
        const res = await request(upsert)
          .get("/api/t1/bookings")
          .set(as("manager"));
        expect(res.status).to.equal(200);
        expect(res.body).to.deep.equal({
          reach: "any",
          reaches: { create: null },
        });
      });

      it("refuses on the main action alone: a second decision of null is the handler's to read", async function () {
        const res = await request(upsert)
          .get("/api/t1/bookings")
          .set(as("customer"));
        expect(res.status).to.equal(403);
      });

      it("names another resource as resource.action", async function () {
        const res = await request(twoResources)
          .get("/api/t1/users")
          .set(as("owner"));
        expect(res.status).to.equal(200);
        expect(res.body).to.deep.equal({
          reach: "any",
          reaches: { owner: "any", "instanceCatalog.store": null },
        });
      });

      it("refuses an unknown second entry when the router is built", function () {
        expect(() =>
          authorize("booking", "update", { also: ["fly"] }),
        ).to.throw(/booking\.fly/);
        expect(() =>
          authorize("booking", "update", { also: ["unicorn.read"] }),
        ).to.throw(/unicorn/);
      });

      it("carries the main action alone as its marker", function () {
        expect(
          markerOf(authorize("booking", "update", { also: ["create"] })),
        ).to.deep.equal({
          marker: "authorize",
          resource: "booking",
          action: "update",
        });
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

    describe("also, and the bundle reachesOf(req) packs (ticket 04)", function () {
      const file = app([
        "/media/:id/file",
        publicRoute("media", "file", { also: ["bookingDocument", "intern"] }),
        (req, res) => res.json(reachesOf(req)),
      ]);

      it("decides the second questions for the anonymous too, never refusing", async function () {
        const res = await request(file).get("/api/t1/media/m1/file");
        expect(res.status).to.equal(200);
        expect(res.body).to.deep.equal({
          file: "public",
          bookingDocument: null,
          intern: null,
          userId: null,
        });
      });

      it("packs the main entry and the second ones by action, with the user", async function () {
        const res = await request(file)
          .get("/api/t1/media/m1/file")
          .set(as("owner"));
        expect(res.body).to.deep.equal({
          file: "any",
          bookingDocument: "any",
          intern: "any",
          userId: "owner",
        });
      });

      it("refuses an unknown second entry, and one without a public entry, when the router is built", function () {
        expect(() => publicRoute("media", "file", { also: ["fly"] })).to.throw(
          /media\.fly/,
        );
        expect(() =>
          publicRoute(undefined, undefined, { also: ["read"] }),
        ).to.throw(/public entry/);
      });

      it("carries the main entry alone as its marker", function () {
        expect(
          markerOf(publicRoute("media", "file", { also: ["intern"] })),
        ).to.deep.equal({
          marker: "public",
          resource: "media",
          action: "file",
        });
      });
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
