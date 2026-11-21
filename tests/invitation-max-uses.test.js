const { expect } = require("chai");
const sinon = require("sinon");

const InvitationService = require("../src/commons/services/invitation-service");
const InvitationManager = require("../src/commons/data-managers/invitation-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");

const TENANT = "stadthalle";
const MEMBER = "neu@example.test";

// Role deletion trusts Invitation.isUsable, so acceptance must refuse
// exactly the invitations isUsable calls used up.
describe("invitation service: a multi-use link at its limit", function () {
  let consumeUse;
  let addMembership;

  function given(overrides) {
    sinon.stub(InvitationManager, "getInvitationByToken").resolves({
      tenantId: TENANT,
      token: "tok-multi",
      type: "multi",
      status: "active",
      intendedUserId: null,
      roles: ["role-sekretariat"],
      challenges: [],
      usedCount: 0,
      maxUses: null,
      expiresAt: null,
      ...overrides,
    });
  }

  beforeEach(function () {
    consumeUse = sinon.stub(InvitationManager, "consumeUse");
    addMembership = sinon.stub(MembershipManager, "addMembership");
  });

  afterEach(function () {
    sinon.restore();
  });

  async function acceptError() {
    try {
      await InvitationService.acceptInvitation(TENANT, "tok-multi", MEMBER);
    } catch (error) {
      return error;
    }
    return null;
  }

  for (const [maxUses, usedCount] of [
    [0, 0],
    [3, 3],
  ]) {
    it(`is refused with maxUses ${maxUses} and usedCount ${usedCount}, before any role or use`, async function () {
      given({ maxUses, usedCount });

      const error = await acceptError();

      expect(error).to.deep.equal({
        message: "Invitation has reached its maximum uses",
        code: 410,
      });
      expect(addMembership.called).to.equal(false);
      expect(consumeUse.called).to.equal(false);
    });
  }
});
