/**
 * The controllers of the instance router on the reach (authorize spec
 * §4.3, ticket 3): a handler hands `scopeOf(req)` to its manager and
 * never branches over rights itself. What is left to the adapter: the
 * creation over the obsolete PUT of tenants and users (§12), the user
 * whose access bookings are asked for (`?userId=`: another user's under
 * `any` only), the protection of a tenant owner against removal by a
 * user manager, and the 404 of a record the manager did not find.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const UserController = require("../src/platform/api/controllers/user-controller");
const AccessController = require("../src/platform/api/controllers/access-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InvitationService = require("../src/commons/services/invitation-service");
const AccessService = require("../src/commons/services/access/access-service");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { ForbiddenError } = require("../src/errors/BaseError");

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
  };
}

/** A request of the instance level with the reach and the principal given. */
function request({ reach, principal, params = {}, query = {}, body = {} }) {
  return {
    params,
    query,
    body,
    reach,
    principal,
    user: principal?.userId ? { id: principal.userId } : null,
  };
}

const principal = (overrides) => ({
  userId: "erika",
  tenantId: null,
  isInstanceOwner: false,
  isTenantOwner: false,
  grants: {},
  mayCreateTenant: false,
  ...overrides,
});
const customer = principal({});
const creator = principal({ userId: "creator", mayCreateTenant: true });
const tenantOwner = principal({
  userId: "owner",
  tenantId: "t1",
  isTenantOwner: true,
});
const userManager = principal({
  userId: "manager",
  tenantId: "t1",
  grants: { manageUsers: { updateAny: true } },
});
const instanceOwner = principal({ userId: "admin", isInstanceOwner: true });

describe("instance controllers on the reach", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("GET /tenants: the list under the reach", function () {
    it("asks the manager for the tenants the user owns, in full", async function () {
      const list = sinon
        .stub(TenantManager, "getTenants")
        .resolves([new Tenant({ id: "t1", name: "Stadt" })]);
      const res = response();
      await TenantController.getTenants(
        request({ reach: "own", principal: customer }),
        res,
      );
      expect(list.firstCall.args).to.deep.equal([
        { reach: "own", userId: "erika" },
        { owned: true },
      ]);
      expect(res.statusCode).to.equal(200);
      expect(res.body[0].id).to.equal("t1");
      expect(res.body[0]).to.have.property("applications");
    });

    it("asks for the tenants of the user's memberships for the public projection", async function () {
      const list = sinon
        .stub(TenantManager, "getTenants")
        .resolves([new Tenant({ id: "t1", name: "Stadt" })]);
      const res = response();
      await TenantController.getTenants(
        request({
          reach: "own",
          principal: customer,
          query: { publicTenants: "true" },
        }),
        res,
      );
      expect(list.firstCall.args).to.deep.equal([
        { reach: "own", userId: "erika" },
        { owned: false },
      ]);
      expect(res.body[0]).to.deep.equal(
        new Tenant({ id: "t1", name: "Stadt" }).exportPublic(),
      );
    });
  });

  describe("a single record the manager does not find", function () {
    it("GET /tenants/:tenant answers 404", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(null);
      const res = response();
      await TenantController.getTenant(
        request({
          reach: "any",
          principal: tenantOwner,
          params: { tenant: "t9" },
        }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(res.body.code).to.equal("tenant_not_found");
    });

    it("DELETE /tenants/:tenant answers 404 and removes nothing", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(null);
      const remove = sinon.stub(TenantManager, "removeTenant").resolves();
      const res = response();
      await TenantController.removeTenant(
        request({
          reach: "any",
          principal: tenantOwner,
          params: { tenant: "t9" },
        }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(remove.called).to.equal(false);
    });

    it("GET /users/:id answers 404", async function () {
      sinon.stub(UserManager, "getUser").resolves(null);
      const res = response();
      await UserController.getUser(
        request({
          reach: "any",
          principal: instanceOwner,
          params: { id: "nobody" },
        }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(res.body.code).to.equal("user_not_found");
    });
  });

  describe("the obsolete PUT: the creation is the adapter's second decision", function () {
    it("PUT /tenants refuses a creation to a principal who may not open a tenant", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(null);
      const store = sinon.stub(TenantManager, "storeTenant").resolves();
      const next = sinon.stub();
      await TenantController.storeTenant(
        request({ reach: "any", principal: customer, body: { id: "new" } }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(store.called).to.equal(false);
    });

    it("PUT /tenants lets a principal with mayCreateTenant create", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(null);
      sinon.stub(TenantManager, "checkTenantCount").resolves(true);
      sinon.stub(InstanceManager, "getInstance").resolves({});
      sinon.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
      const store = sinon.stub(TenantManager, "storeTenant").resolves();
      sinon.stub(MembershipManager, "addMembership").resolves();
      const res = response();
      await TenantController.storeTenant(
        request({ reach: "any", principal: creator, body: { id: "new" } }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(201);
      expect(store.calledOnce).to.equal(true);
    });

    it("PUT /users refuses a creation to a principal who is not the instance owner", async function () {
      sinon.stub(UserManager, "getUser").resolves(null);
      const create = sinon.stub(UserManager, "createUser").resolves();
      const next = sinon.stub();
      await UserController.storeUser(
        request({
          reach: "any",
          principal: tenantOwner,
          body: { id: "new@x" },
        }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(create.called).to.equal(false);
    });

    it("PUT /users lets the instance owner create", async function () {
      sinon.stub(UserManager, "getUser").resolves(null);
      const create = sinon
        .stub(UserManager, "createUser")
        .resolves({ id: "new@x" });
      const res = response();
      await UserController.storeUser(
        request({
          reach: "any",
          principal: instanceOwner,
          body: { id: "new@x", secret: "pw" },
        }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(200);
      expect(create.calledOnce).to.equal(true);
    });
  });

  describe("GET /access/bookings: whose bookings", function () {
    let bookings;

    beforeEach(function () {
      bookings = sinon
        .stub(AccessService, "getUserBookingsWithAccess")
        .resolves([]);
    });

    it("answers the own bookings under own", async function () {
      const res = response();
      await AccessController.getAccessBookings(
        request({ reach: "own", principal: customer }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(200);
      expect(bookings.firstCall.args[0]).to.equal("erika");
    });

    it("refuses another user's bookings under own", async function () {
      const next = sinon.stub();
      await AccessController.getAccessBookings(
        request({
          reach: "own",
          principal: customer,
          query: { userId: "max" },
        }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(bookings.called).to.equal(false);
    });

    it("answers another user's bookings under any", async function () {
      await AccessController.getAccessBookings(
        request({
          reach: "any",
          principal: instanceOwner,
          query: { userId: "max" },
        }),
        response(),
        sinon.stub(),
      );
      expect(bookings.firstCall.args[0]).to.equal("max");
    });
  });

  describe("POST /tenants/:tenant/remove-user: the owner's protection", function () {
    beforeEach(function () {
      sinon
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({ tenantId: "t1", userId: "boss", owner: true });
      sinon.stub(MembershipManager, "getMembershipsByTenantID").resolves([]);
      sinon.stub(UserManager, "getUsersById").resolves([]);
      sinon.stub(InvitationService, "deleteUserInvitations").resolves();
    });

    it("refuses a user manager who is no owner", async function () {
      const remove = sinon
        .stub(MembershipManager, "removeMembership")
        .resolves();
      const next = sinon.stub();
      await TenantController.removeUser(
        request({
          reach: "any",
          principal: userManager,
          params: { tenant: "t1" },
          body: { userId: "boss" },
        }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(remove.called).to.equal(false);
    });

    it("lets the instance owner remove an owner, membership or not", async function () {
      const remove = sinon
        .stub(MembershipManager, "removeMembership")
        .resolves();
      const res = response();
      await TenantController.removeUser(
        request({
          reach: "any",
          principal: instanceOwner,
          params: { tenant: "t1" },
          body: { userId: "boss" },
        }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(200);
      expect(remove.calledOnce).to.equal(true);
    });
  });
});
