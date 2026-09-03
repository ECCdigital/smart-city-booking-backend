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

  it("should return all roles for public view", async () => {
    sandbox
      .stub(RoleManager, "getRoles")
      .resolves(roles.map((r) => ({ toPublic: () => r.id + "Public" })));

    req.query.public = "true";
    await RoleController.getRoles(req, res);

    expect(RoleManager.getRoles.calledOnce).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(["role1Public", "role2Public"])).to.be.true;
  });

  it("should return all roles for private view under the reach any", async () => {
    sandbox.stub(RoleManager, "getRoles").resolves(roles);

    req.reach = "any";
    req.query.public = "false";
    await RoleController.getRoles(req, res);

    expect(RoleManager.getRoles.calledOnce).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(roles)).to.be.true;
  });

  it("should return tenant-specific public roles", async () => {
    sandbox
      .stub(RoleManager, "getTenantRoles")
      .resolves(roles.map((r) => ({ toPublic: () => r.id + "TenantPublic" })));

    req.query.public = "true";
    req.params.tenant = "tenant123";
    await RoleController.getRoles(req, res);

    expect(RoleManager.getTenantRoles.calledOnceWith("tenant123")).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(["role1TenantPublic", "role2TenantPublic"])).to
      .be.true;
  });

  it("answers the public projection under the reach own, where asked for", async () => {
    sandbox
      .stub(RoleManager, "getTenantRoles")
      .resolves(roles.map((r) => ({ toPublic: () => r.id + "Public" })));

    req.params.tenant = "tenant123";
    req.reach = "own";
    req.query.public = "true";
    await RoleController.getRoles(req, res);

    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(["role1Public", "role2Public"])).to.be.true;
  });

  it("answers no roles under the reach own: a role has no owner", async () => {
    sandbox.stub(RoleManager, "getTenantRoles").resolves(roles);

    req.params.tenant = "tenant123";
    req.reach = "own";
    await RoleController.getRoles(req, res);

    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith([])).to.be.true;
  });

  it("should return 500 and log error on failure", async () => {
    sandbox.stub(RoleManager, "getRoles").rejects(new Error("Database Error"));

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
