const { expect } = require("chai");
const sinon = require("sinon");

const UserController = require("../src/platform/api/controllers/user-controller");
const UserService = require("../src/commons/services/user-service");
const UserManager = require("../src/commons/data-managers/user-manager");
const PermissionService = require("../src/commons/services/permission-service");
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

      expect(syncStub.calledOnceWith(user.id, "Augusta", "Lovelace")).to.be
        .true;
      expect(res.status.calledWith(200)).to.be.true;
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

      expect(updateStub.calledOnce).to.be.true;
      expect(syncStub.called).to.be.false;
      expect(res.status.calledWith(200)).to.be.true;
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
      sandbox.stub(PermissionService, "_isInstanceOwner").resolves(true);
      sandbox.stub(UserManager, "getUser").resolves({ ...existingUser });
      sandbox.stub(UserManager, "updateUser").resolves();
    });

    it("syncs booking names by default when lastName changes", async () => {
      const syncStub = sandbox
        .stub(UserService, "syncSelfBookingNames")
        .resolves();

      await UserController.updateUser(buildRequest({ lastName: "Byron" }), res);

      expect(syncStub.calledOnceWith(existingUser.id, "Ada", "Byron")).to.be
        .true;
      expect(res.sendStatus.calledWith(200)).to.be.true;
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

      expect(syncStub.called).to.be.false;
      expect(res.sendStatus.calledWith(200)).to.be.true;
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

      expect(syncStub.calledOnceWith(currentUser.id, "Augusta Byron")).to.be
        .true;
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

      expect(result).to.deep.equal({
        id: currentUser.id,
        firstName: "Augusta",
        lastName: "Byron",
      });
      expect(syncStub.called).to.be.false;
    });
  });
});
