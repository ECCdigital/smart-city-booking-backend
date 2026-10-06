const assert = require("assert");
const sinon = require("sinon");

const { User } = require("../src/commons/entities/user/user");
const UserController = require("../src/platform/api/controllers/user-controller");
const UserManager = require("../src/commons/data-managers/user-manager");
const UserService = require("../src/commons/services/user-service");

describe("User vatId", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("defaults to an empty string and is kept when given", () => {
    assert.strictEqual(new User({ id: "a@example.com" }).vatId, "");

    const user = User.create({ id: "a@example.com", vatId: "DE123456789" });
    assert.strictEqual(user.vatId, "DE123456789");
  });

  it("is part of the public export", () => {
    const user = new User({ id: "a@example.com", vatId: "DE123456789" });
    assert.strictEqual(user.exportPublic().vatId, "DE123456789");
  });

  it("is accepted by updateMe", async () => {
    const stored = { id: "a@example.com", firstName: "Ada", vatId: "" };
    sinon.stub(UserManager, "getUser").resolves(stored);
    const updateStub = sinon.stub(UserManager, "updateUser").resolves();
    sinon.stub(UserService, "syncSelfBookingNames").resolves();
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.stub(),
      sendStatus: sinon.stub(),
    };

    await UserController.updateMe(
      { user: { id: stored.id }, body: { vatId: "DE123456789" } },
      res,
    );

    assert.strictEqual(updateStub.firstCall.args[0].vatId, "DE123456789");
  });

  it("is accepted by updateUser", async () => {
    const stored = { id: "a@example.com", vatId: "" };
    sinon.stub(UserManager, "getUser").resolves(stored);
    const updateStub = sinon.stub(UserManager, "updateUser").resolves();
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.stub(),
      sendStatus: sinon.stub(),
    };

    await UserController.updateUser(
      {
        user: { id: "admin@example.com" },
        body: { id: stored.id, vatId: "DE123456789" },
      },
      res,
    );

    assert.strictEqual(updateStub.firstCall.args[0].vatId, "DE123456789");
  });
});
