const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const { Role } = require("../src/commons/entities/role/role.js");

describe("RoleController.getRoles", () => {
  let sandbox, fakeLogger, RoleController, RoleManager;
  let req, res, roles;

  beforeEach(() => {
    roles = [
      new Role({
        id: "role1",
        name: "Admin",
        tenantId: "tenant123",
        assignedUserId: "user123",
      }),
      new Role({
        id: "role2",
        name: "User",
        tenantId: "tenant123",
        assignedUserId: "user999",
      }),
    ];

    sandbox = sinon.createSandbox();

    fakeLogger = {
      error: sandbox.stub(),
      info: sandbox.stub(),
      debug: sandbox.stub(),
    };

    mock("../src/middleware/logger", () => fakeLogger);

    RoleController = mock.reRequire(
      "../src/platform/api/controllers/role-controller.js",
    );
    RoleManager =
      require("../src/commons/data-managers/role-manager").RoleManager;

    req = { user: { id: "user123" }, params: {}, query: {} };
    res = { status: sandbox.stub().returnsThis(), send: sandbox.stub() };
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  /** The principal of a request: signed in, a member where said. */
  const principal = (isMember, userId = "user123") => ({
    userId,
    isMember,
  });

  it("answers every role of every tenant under the reach any, where the projection is not asked for", async () => {
    sandbox.stub(RoleManager, "getRoles").resolves(roles);

    req.reach = "any";
    req.query.public = "false";
    await RoleController.getRoles(req, res);

    expect(RoleManager.getRoles.calledOnce).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(roles)).to.be.true;
  });

  it("answers the tenant's roles under the reach any, whole and not projected", async () => {
    sandbox.stub(RoleManager, "getTenantRoles").resolves(roles);

    req.reach = "any";
    req.query.public = "true";
    req.params.tenant = "tenant123";
    await RoleController.getRoles(req, res);

    expect(RoleManager.getTenantRoles.calledOnceWith("tenant123")).to.be.true;
    expect(res.send.calledWith(roles)).to.be.true;
  });

  it("answers the public projection of the tenant under the reach own to a member", async () => {
    sandbox.stub(RoleManager, "getTenantRoles").resolves(roles);

    req.params.tenant = "tenant123";
    req.reach = "own";
    req.principal = principal(true);
    req.query.public = "true";
    await RoleController.getRoles(req, res);

    expect(res.status.calledWith(200)).to.be.true;
    expect(
      res.send.calledWith([
        { id: "role1", name: "Admin", tenantId: "tenant123" },
        { id: "role2", name: "User", tenantId: "tenant123" },
      ]),
    ).to.be.true;
  });

  it("answers the projection under the reach own without asking the membership again: the marker vouched for it", async () => {
    const UserManager = require("../src/commons/data-managers/user-manager");
    const MembershipManager = require("../src/commons/data-managers/membership-manager");
    sandbox.stub(RoleManager, "getTenantRoles").resolves(roles);
    const permissions = sandbox.stub(UserManager, "getMembershipPicture");
    const membership = sandbox.stub(
      MembershipManager,
      "getMembershipByTenantAndUserID",
    );

    req.params.tenant = "tenant123";
    req.reach = "own";
    req.principal = principal(true);
    req.query.public = "true";
    await RoleController.getRoles(req, res);

    expect(res.status.calledWith(200)).to.be.true;
    expect(
      res.send.calledWith([
        { id: "role1", name: "Admin", tenantId: "tenant123" },
        { id: "role2", name: "User", tenantId: "tenant123" },
      ]),
    ).to.be.true;
    expect(permissions.called).to.be.false;
    expect(membership.called).to.be.false;
  });

  it("answers no roles under the reach own without the projection: a role has no owner", async () => {
    sandbox.stub(RoleManager, "getTenantRoles").resolves(roles);

    req.params.tenant = "tenant123";
    req.reach = "own";
    req.principal = principal(true);
    await RoleController.getRoles(req, res);

    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith([])).to.be.true;
  });

  it("should return 500 and log error on failure", async () => {
    sandbox.stub(RoleManager, "getRoles").rejects(new Error("Database Error"));

    req.reach = "any";
    await RoleController.getRoles(req, res);

    sinon.assert.calledWith(res.status, 500);
    sinon.assert.calledWith(res.send, "Could not get roles");

    sinon.assert.calledOnce(fakeLogger.error);
    sinon.assert.calledWithMatch(
      fakeLogger.error,
      sinon.match.instanceOf(Error),
    );
  });
});

describe("RoleController.getUserRolesByTenant", () => {
  let sandbox, RoleController, RoleManager, MembershipManager;
  let req, res;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mock("../src/middleware/logger", () => ({
      error: sandbox.stub(),
      info: sandbox.stub(),
      debug: sandbox.stub(),
    }));
    RoleController = mock.reRequire(
      "../src/platform/api/controllers/role-controller.js",
    );
    RoleManager =
      require("../src/commons/data-managers/role-manager").RoleManager;
    MembershipManager = require("../src/commons/data-managers/membership-manager");
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: ["role1"] });
    sandbox
      .stub(RoleManager, "getRole")
      .resolves(new Role({ id: "role1", name: "Admin", tenantId: "t1" }));
    req = { params: { tenant: "t1" }, query: {} };
    res = { status: sandbox.stub().returnsThis(), json: sandbox.stub() };
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("reads the roles of the membership for a member", async () => {
    req.principal = { userId: "u1", isMember: true };
    await RoleController.getUserRolesByTenant(req, res);

    expect(
      MembershipManager.getMembershipByTenantAndUserID.calledOnceWith(
        "t1",
        "u1",
      ),
    ).to.be.true;
    expect(res.json.firstCall.args[0].map((r) => r.id)).to.deep.equal([
      "role1",
    ]);
  });

  it("answers an empty list where the membership rests, without asking the store", async () => {
    req.principal = { userId: "u1", isMember: false };
    await RoleController.getUserRolesByTenant(req, res);

    expect(MembershipManager.getMembershipByTenantAndUserID.called).to.be.false;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.json.calledWith([])).to.be.true;
  });
});
