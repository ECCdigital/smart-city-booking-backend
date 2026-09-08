const assert = require("assert");
const sinon = require("sinon");

const UserController = require("../src/platform/api/controllers/user-controller");
const UserService = require("../src/commons/services/user-service");
const UserManager = require("../src/commons/data-managers/user-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");

describe("syncSelfBookingNames flag", () => {
  let sandbox;
  let res;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    res = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("UserController.updateMe", () => {
    const user = {
      id: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    };

    function buildRequest(body) {
      return {
        user: { id: user.id },
        body,
      };
    }

    it("syncs booking names by default when firstName changes", async () => {
      sandbox.stub(UserManager, "getUser").resolves({ ...user });
      sandbox.stub(UserManager, "updateUser").resolves();
      const syncStub = sandbox
        .stub(UserService, "syncSelfBookingNames")
        .resolves();

      await UserController.updateMe(
        buildRequest({ firstName: "Augusta" }),
        res,
      );

      assert.ok(syncStub.calledOnceWith(user.id, "Augusta", "Lovelace"));
      assert.ok(res.status.calledWith(200));
    });

    it("skips booking name sync when syncSelfBookingNames is false", async () => {
      const updateStub = sandbox.stub(UserManager, "updateUser").resolves();
      sandbox.stub(UserManager, "getUser").resolves({ ...user });
      const syncStub = sandbox
        .stub(UserService, "syncSelfBookingNames")
        .resolves();

      await UserController.updateMe(
        buildRequest({
          firstName: "Augusta",
          syncSelfBookingNames: false,
        }),
        res,
      );

      assert.ok(updateStub.calledOnce);
      assert.ok(!syncStub.called);
      assert.ok(res.status.calledWith(200));
    });
  });

  describe("UserController.updateUser", () => {
    const existingUser = {
      id: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    };

    function buildRequest(body) {
      return {
        user: { id: existingUser.id },
        body: { id: existingUser.id, ...body },
      };
    }

    beforeEach(() => {
      sandbox.stub(UserManager, "getUser").resolves({ ...existingUser });
      sandbox.stub(UserManager, "updateUser").resolves();
    });

    it("syncs booking names by default when lastName changes", async () => {
      const syncStub = sandbox
        .stub(UserService, "syncSelfBookingNames")
        .resolves();

      await UserController.updateUser(buildRequest({ lastName: "Byron" }), res);

      assert.ok(syncStub.calledOnceWith(existingUser.id, "Ada", "Byron"));
      assert.ok(res.sendStatus.calledWith(200));
    });

    it("skips booking name sync when syncSelfBookingNames is false", async () => {
      const syncStub = sandbox
        .stub(UserService, "syncSelfBookingNames")
        .resolves();

      await UserController.updateUser(
        buildRequest({
          firstName: "Augusta",
          lastName: "Byron",
          syncSelfBookingNames: false,
        }),
        res,
      );

      assert.ok(!syncStub.called);
      assert.ok(res.sendStatus.calledWith(200));
    });
  });

  describe("UserService.updateUserNames", () => {
    const currentUser = {
      _id: "mongo-id-1",
      id: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    };

    beforeEach(() => {
      sandbox
        .stub(UserManager, "findRawUserByIdOrKeycloak")
        .resolves(currentUser);
      sandbox.stub(UserManager, "updateUserNamesByMongoId").resolves({
        id: currentUser.id,
        firstName: "Augusta",
        lastName: "Byron",
      });
    });

    it("syncs booking names by default", async () => {
      const syncStub = sandbox
        .stub(BookingManager, "updateAssignedSelfBookingNames")
        .resolves();

      await UserService.updateUserNames({
        userId: currentUser.id,
        firstName: "Augusta",
        lastName: "Byron",
      });

      assert.ok(syncStub.calledOnceWith(currentUser.id, "Augusta Byron"));
    });

    it("skips booking name sync when syncSelfBookingNames is false", async () => {
      const syncStub = sandbox
        .stub(BookingManager, "updateAssignedSelfBookingNames")
        .resolves();

      const result = await UserService.updateUserNames({
        userId: currentUser.id,
        firstName: "Augusta",
        lastName: "Byron",
        syncSelfBookingNames: false,
      });

      assert.deepStrictEqual(result, {
        id: currentUser.id,
        firstName: "Augusta",
        lastName: "Byron",
      });
      assert.ok(!syncStub.called);
    });
  });
});
