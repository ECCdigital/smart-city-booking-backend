const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const { User } = require("../../src/commons/entities/user/user");

describe("UserController — changeMyPassword (logged-in password change)", () => {
  let sandbox;
  let UserManager;
  let UserController;
  let JwtHelper;

  const res = () => ({
    statusCode: null,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    sendStatus(c) {
      this.statusCode = c;
      return this;
    },
  });
  const req = (body) => ({ user: { id: "u@x.de" }, body: body || {} });

  const makeUser = (password) => {
    const u = new User({ id: "u@x.de", firstName: "U", lastName: "X" });
    u.setPassword(password);
    return u;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    UserManager = {
      getUserBy: sandbox.stub().resolves(null),
      updateUser: sandbox.stub().resolves(),
    };
    mock("../../src/commons/data-managers/user-manager", UserManager);
    JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };
    mock("../../src/commons/utilities/jwt-helper", JwtHelper);
    UserController = mock.reRequire(
      "../../src/platform/api/controllers/user-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("400 when fields are missing", async () => {
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "old12345" }),
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("404 when the signed-in user no longer exists", async () => {
    // getUserBy stays at its null default
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "realold12", newPassword: "newsecret123" }),
      r,
    );
    expect(r.statusCode).to.equal(404);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("400 when the new password is too short", async () => {
    UserManager.getUserBy.resolves(makeUser("realold12"));
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "realold12", newPassword: "short" }),
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("403 when the current password is incorrect", async () => {
    UserManager.getUserBy.resolves(makeUser("realold12"));
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "wrongpass", newPassword: "newsecret123" }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("200 and actually changes the password when the current one is correct", async () => {
    UserManager.getUserBy.resolves(makeUser("realold12"));
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "realold12", newPassword: "newsecret123" }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(UserManager.updateUser.calledOnce).to.equal(true);
    const saved = UserManager.updateUser.firstCall.args[0];
    expect(saved.verifyPassword("newsecret123")).to.equal(true);
    expect(saved.verifyPassword("realold12")).to.equal(false);
  });

  it("revokes all existing sessions after a successful change", async () => {
    UserManager.getUserBy.resolves(makeUser("realold12"));
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "realold12", newPassword: "newsecret123" }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(JwtHelper.revokeAllUserTokens.calledOnce).to.equal(true);
    expect(JwtHelper.revokeAllUserTokens.firstCall.args[0]).to.equal("u@x.de");
  });

  it("looks the user up by EXACT id (not the unanchored regex getUser)", async () => {
    UserManager.getUserBy.resolves(makeUser("realold12"));
    const r = res();
    await UserController.changeMyPassword(
      req({ currentPassword: "realold12", newPassword: "newsecret123" }),
      r,
    );
    expect(UserManager.getUserBy.calledWith({ id: "u@x.de" }, true)).to.equal(
      true,
    );
  });
});
