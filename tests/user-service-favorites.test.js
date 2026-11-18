/**
 * The favorites in the user lifecycle (glossary "Favorit"): a change of
 * the user id moves them in the same transaction as the other references
 * of the user, and the removal of a user removes them with the user.
 */

const { expect } = require("chai");
const mongoose = require("mongoose");
const sinon = require("sinon");

const UserService = require("../src/commons/services/user-service");
const UserManager = require("../src/commons/data-managers/user-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const CouponManager = require("../src/commons/data-managers/coupon-manager");
const FavoriteManager = require("../src/commons/data-managers/favorite-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const TokenSessionService = require("../src/commons/services/token-session-service");

const PREVIOUS = "alt@example.test";
const NEXT = "neu@example.test";

describe("UserService: the favorites follow the user", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("changeUserId moves the favorites in the transaction of the other references", async function () {
    // The session the service opens: `withTransaction` runs the change,
    // and the service hands the session itself to every reassign.
    const session = {
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    };
    sinon.stub(mongoose, "startSession").resolves(session);
    sinon
      .stub(UserManager, "findRawUserByIdOrKeycloak")
      .resolves({ _id: "64f1", id: PREVIOUS });
    // No account holds the new id yet (ECCdigital/tickets#259: looked up
    // as every account by its id).
    sinon.stub(UserManager, "getRawUser").resolves(null);
    sinon.stub(UserManager, "updateUserByMongoId").resolves();
    for (const [Manager, method] of [
      [BookingManager, "reassignUserReferences"],
      [GroupBookingManager, "reassignUserReferences"],
      [BookableManager, "reassignOwnerUserId"],
      [EventManager, "reassignOwnerUserId"],
      [CouponManager, "reassignOwnerUserId"],
      [MembershipManager, "reassignUserId"],
      [TokenSessionService, "reassignUserId"],
      [InstanceManager, "reassignOwnerUserId"],
    ]) {
      sinon.stub(Manager, method).resolves();
    }
    const reassign = sinon.stub(FavoriteManager, "reassignUserId").resolves();

    const result = await UserService.changeUserId({
      currentId: PREVIOUS,
      newId: NEXT,
    });

    expect(result).to.deep.equal({
      previousId: PREVIOUS,
      id: NEXT,
      changed: true,
    });
    expect(reassign.calledOnce).to.equal(true);
    expect(reassign.firstCall.args).to.deep.equal([PREVIOUS, NEXT, session]);
    expect(MembershipManager.reassignUserId.firstCall.args[2]).to.equal(
      session,
    );
  });

  it("deleteUser removes the favorites of the user, then the user", async function () {
    const calls = [];
    sinon
      .stub(FavoriteManager, "removeFavoritesOfUser")
      .callsFake(async (userId) => calls.push(["favorites", userId]));
    sinon
      .stub(UserManager, "deleteUser")
      .callsFake(async (userId) => calls.push(["user", userId]));

    await UserService.deleteUser(PREVIOUS);

    expect(calls).to.deep.equal([
      ["favorites", PREVIOUS],
      ["user", PREVIOUS],
    ]);
  });
});
